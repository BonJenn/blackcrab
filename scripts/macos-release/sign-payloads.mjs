import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify, parseArgs} from 'node:util';
import {verifyArtifact as verifyDesktop, writeManifest, inventory, fileDigest, MANIFEST, ELECTRON} from '../../managed-desktop/artifact.mjs';
import {writeArtifactManifest, MANIFEST_FILE} from '../../managed-host/artifact.mjs';
import {verifyServiceProfileArtifact} from '../../managed-host/service-profile.mjs';
import {validateSigningIdentity, machoFiles, verifySignature, verifySigningDelta} from './signatures.mjs';

const exec = promisify(execFile), here = path.dirname(fileURLToPath(import.meta.url));
const hostEntries = manifest => manifest.files.map(entry => ({...entry, type: 'file'}));
async function absent(file) {
  try { await fs.lstat(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw Error('Release output already exists');
}
function outside(input, output) {
  const relative = path.relative(input, output);
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
    throw Error('Release output must be outside the verified input artifact');
  }
}

/** Derive new signed artifacts; original build artifacts and their manifests stay immutable. */
export async function signManagedPayloads({desktop, serviceHost, output, identity, teamId, keychain}) {
  validateSigningIdentity(identity, teamId);
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw Error('Release signing requires an Apple-silicon Mac');
  for (const value of [desktop, serviceHost, output]) {
    if (typeof value !== 'string' || !path.isAbsolute(value)) throw Error('Absolute artifact paths are required');
  }
  await absent(output);
  const parent = await fs.realpath(path.dirname(output));
  output = path.join(parent, path.basename(output));
  for (const input of [desktop, serviceHost]) outside(await fs.realpath(input), output);
  if (keychain !== undefined && (!path.isAbsolute(keychain) || !(await fs.stat(keychain)).isFile())) throw Error('Invalid signing keychain');
  const desktopManifest = await verifyDesktop(desktop);
  const hostManifest = await verifyServiceProfileArtifact(serviceHost);
  const inputPins = {
    desktop: await fileDigest(path.join(desktop, MANIFEST)),
    serviceHost: await fileDigest(path.join(serviceHost, MANIFEST_FILE)),
  };
  // Imported lazily so portable verification/tests do not need release-only dependencies.
  const {sign} = await import('@electron/osx-sign');
  const stage = await fs.mkdtemp(path.join(parent, '.blackcrab-signed-payloads-'));
  await fs.chmod(stage, 0o700);
  const report = {schema: 1, state: 'SIGNING', target: 'darwin-arm64', identity, teamId, inputPins, notarized: false, launchPerformed: false};
  try {
    const signedDesktop = path.join(stage, 'desktop'), signedHost = path.join(stage, 'service-host');
    await fs.cp(desktop, signedDesktop, {recursive: true, verbatimSymlinks: true});
    await fs.cp(serviceHost, signedHost, {recursive: true, verbatimSymlinks: true});
    await verifyDesktop(signedDesktop); await verifyServiceProfileArtifact(signedHost);
    const desktopBinaries = await machoFiles(signedDesktop), hostBinaries = await machoFiles(signedHost);
    if (!desktopBinaries.includes('Blackcrab.app/Contents/MacOS/Blackcrab') || !hostBinaries.includes('t3') ||
        !hostBinaries.includes('resource-monitor/t3-resource-monitor')) throw Error('Expected native release targets are absent');
    const app = path.join(signedDesktop, 'Blackcrab.app');
    await sign({
      app, platform: 'darwin', type: 'distribution', version: ELECTRON.version,
      identity, ...(keychain ? {keychain} : {}), identityValidation: true,
      preAutoEntitlements: false, preEmbedProvisioningProfile: false, strictVerify: true,
      batchCodesignCalls: true,
      optionsForFile: file => ({hardenedRuntime: true,
        ...(file === app ? {entitlements: path.join(here, 'desktop-entitlements.plist')} : {})}),
    });
    // Node SEA, native add-ons, spawn helper and resource monitor all need signed code.
    for (const relative of [...hostBinaries.filter(file => file !== 't3'), 't3']) {
      await exec('/usr/bin/codesign', ['--force', '--sign', identity, '--options', 'runtime', '--timestamp',
        ...(keychain ? ['--keychain', keychain] : []),
        ...(relative === 't3' ? ['--entitlements', path.join(here, 'host-entitlements.plist')] : []),
        path.join(signedHost, relative)], {timeout: 300000, maxBuffer: 1024 * 1024});
    }
    for (const [root, binaries] of [[signedDesktop, desktopBinaries], [signedHost, hostBinaries]]) {
      for (const relative of binaries) await verifySignature(path.join(root, relative), {identity, teamId});
    }
    await verifySignature(app, {identity, teamId}, {deep: true});
    const desktopChanges = verifySigningDelta(desktopManifest.files, await inventory(signedDesktop), desktopBinaries);
    // Host inventory has a different file-only shape; regenerate solely in this owned copy.
    await fs.unlink(path.join(signedHost, MANIFEST_FILE));
    const signedHostManifest = await writeArtifactManifest(signedHost, {platform: 'darwin', arch: 'arm64', sourcePatches: hostManifest.sourcePatches});
    const hostChanges = verifySigningDelta(hostEntries(hostManifest), hostEntries(signedHostManifest), hostBinaries);
    for (const [root, role, binaries, changes] of [
      [signedDesktop, 'desktop', desktopBinaries, desktopChanges],
      [signedHost, 'serviceHost', hostBinaries, hostChanges],
    ]) {
      // Keep original compiler provenance, append a distinct distribution-signing derivation.
      const file = path.join(root, 'BUILD-PROVENANCE.json'), provenance = JSON.parse(await fs.readFile(file, 'utf8'));
      provenance.distributionSigning = {schema: 1, kind: 'developer-id', identity, teamId, sourceManifestSha256: inputPins[role], nativeFiles: binaries, changedFiles: changes, notarized: false};
      await fs.writeFile(file, JSON.stringify(provenance, null, 2) + '\n');
    }
    await writeManifest(signedDesktop, {sourcePatches: desktopManifest.sourcePatches, availability: desktopManifest.availability});
    await fs.unlink(path.join(signedHost, MANIFEST_FILE));
    await writeArtifactManifest(signedHost, {platform: 'darwin', arch: 'arm64', sourcePatches: hostManifest.sourcePatches});
    await verifyDesktop(signedDesktop); await verifyServiceProfileArtifact(signedHost);
    await verifyDesktop(desktop); await verifyServiceProfileArtifact(serviceHost);
    if (await fileDigest(path.join(desktop, MANIFEST)) !== inputPins.desktop ||
        await fileDigest(path.join(serviceHost, MANIFEST_FILE)) !== inputPins.serviceHost) throw Error('Original artifact manifest changed');
    Object.assign(report, {state: 'DEVELOPER_ID_SIGNED_NOT_NOTARIZED', inputArtifactsUnchanged: true,
      desktopNativeFiles: desktopBinaries.length, hostNativeFiles: hostBinaries.length,
      desktopManifestSha256: await fileDigest(path.join(signedDesktop, MANIFEST)),
      serviceHostManifestSha256: await fileDigest(path.join(signedHost, MANIFEST_FILE))});
    await fs.writeFile(path.join(stage, 'signing-result.json'), JSON.stringify(report, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    await absent(output); await fs.rename(stage, output);
    return {...report, output};
  } catch (error) {
    // Preserve this owned failed derivation for diagnosis; it is never a release candidate.
    report.state = 'SIGNING_FAILED_UNPUBLISHED'; report.error = error.message;
    await fs.writeFile(path.join(stage, 'signing-result.json'), JSON.stringify(report, null, 2) + '\n', {mode: 0o600});
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const {values} = parseArgs({options: {
    desktop: {type:'string'}, 'service-host': {type:'string'}, output: {type:'string'},
    identity: {type:'string'}, team: {type:'string'}, keychain: {type:'string'},
  }});
  const result = await signManagedPayloads({desktop: values.desktop, serviceHost: values['service-host'], output: values.output, identity: values.identity, teamId: values.team, keychain: values.keychain});
  console.log(JSON.stringify(result));
}
