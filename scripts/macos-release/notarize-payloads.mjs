import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify, parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {verifyArtifact as verifyDesktop, writeManifest, fileDigest, MANIFEST} from '../../managed-desktop/artifact.mjs';
import {writeArtifactManifest, MANIFEST_FILE} from '../../managed-host/artifact.mjs';
import {verifyServiceProfileArtifact} from '../../managed-host/service-profile.mjs';
import {machoFiles, verifySignature, validateSigningIdentity} from './signatures.mjs';

const exec = promisify(execFile);
const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
async function absent(file) {
  try { await fs.lstat(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw Error('Notarization output already exists');
}
export function acceptedSubmission(value) {
  if (value?.status !== 'Accepted' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.id ?? '')) {
    throw Error('Apple has not accepted this notarization submission');
  }
  return {id: value.id, status: value.status};
}
export function validateNotaryCredentials({key, keyId, issuer}) {
  if (typeof key !== 'string' || !path.isAbsolute(key) || !/^[A-Z0-9]{10}$/.test(keyId ?? '') ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(issuer ?? '')) throw Error('Explicit private notary key file and API identifiers are required');
}

/** Submit all inner native payloads, then staple and re-pin new copies. No activation or publication. */
export async function notarizeManagedPayloads({input, output, key, keyId, issuer}) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw Error('Apple-silicon macOS required');
  validateNotaryCredentials({key, keyId, issuer});
  const keyStat = await fs.lstat(key);
  if (!keyStat.isFile() || keyStat.isSymbolicLink() || keyStat.uid !== process.getuid() || (keyStat.mode & 0o077)) throw Error('Notary key must be an owner-only regular file');
  for (const value of [input, output]) if (typeof value !== 'string' || !path.isAbsolute(value)) throw Error('Absolute release paths required');
  input = await fs.realpath(input);
  if (JSON.stringify((await fs.readdir(input)).sort()) !== JSON.stringify(['desktop', 'service-host', 'signing-result.json'])) {
    throw Error('Signed payload directory contains unexpected top-level files');
  }
  output = path.join(await fs.realpath(path.dirname(output)), path.basename(output));
  const relative = path.relative(input, output);
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw Error('Notarized output must be outside its immutable input');
  await absent(output);
  const signing = await read(path.join(input, 'signing-result.json'));
  if (signing.state !== 'DEVELOPER_ID_SIGNED_NOT_NOTARIZED' || signing.target !== 'darwin-arm64' || signing.notarized !== false) throw Error('Verified signed payload derivation required');
  const options = {identity: signing.identity, teamId: signing.teamId};
  validateSigningIdentity(options.identity, options.teamId);
  const desktop = path.join(input, 'desktop'), host = path.join(input, 'service-host');
  const desktopManifest = await verifyDesktop(desktop), hostManifest = await verifyServiceProfileArtifact(host);
  if (await fileDigest(path.join(desktop, MANIFEST)) !== signing.desktopManifestSha256 ||
      await fileDigest(path.join(host, MANIFEST_FILE)) !== signing.serviceHostManifestSha256) throw Error('Signed artifact pins differ');
  for (const root of [desktop, host]) for (const file of await machoFiles(root)) await verifySignature(path.join(root, file), options);
  await verifySignature(path.join(desktop, 'Blackcrab.app'), options, {deep: true});
  const stage = await fs.mkdtemp(path.join(path.dirname(output), '.blackcrab-notarized-payloads-'));
  await fs.chmod(stage, 0o700);
  const payloads = path.join(stage, 'payloads');
  await fs.cp(input, payloads, {recursive: true, verbatimSymlinks: true});
  await verifyDesktop(path.join(payloads, 'desktop')); await verifyServiceProfileArtifact(path.join(payloads, 'service-host'));
  const archiveName = `blackcrab-inner-${signing.desktopManifestSha256.slice(0,12)}-${signing.serviceHostManifestSha256.slice(0,12)}.zip`;
  const archive = path.join(stage, archiveName);
  const report = {schema:1, state:'SUBMITTING', archiveName, startedAt:new Date().toISOString(), target:'darwin-arm64', teamId:signing.teamId, installed:false, published:false};
  const save = () => fs.writeFile(path.join(stage, 'notarization-result.json'), JSON.stringify(report, null, 2) + '\n', {mode:0o600});
  await save();
  try {
    await exec('/usr/bin/ditto', ['-c', '-k', '--keepParent', payloads, archive], {timeout:300000});
    report.submittedArchiveSha256 = await fileDigest(archive); await save();
    const auth = ['--key', key, '--key-id', keyId, '--issuer', issuer];
    const result = await exec('/usr/bin/xcrun', ['notarytool', 'submit', archive, ...auth, '--wait', '--timeout', '30m', '--output-format', 'json'], {timeout:31 * 60 * 1000, maxBuffer:2 * 1024 * 1024});
    await fs.writeFile(path.join(stage, 'submission-response.private.json'), result.stdout, {mode:0o600});
    report.submission = acceptedSubmission(JSON.parse(result.stdout)); await save();
    const app = path.join(payloads, 'desktop/Blackcrab.app');
    await exec('/usr/bin/xcrun', ['stapler', 'staple', app], {timeout:300000});
    await exec('/usr/bin/xcrun', ['stapler', 'validate', app], {timeout:300000});
    await verifySignature(app, options, {deep:true});
    await exec('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', app], {timeout:300000});
    for (const role of ['desktop', 'service-host']) {
      const root = path.join(payloads, role);
      for (const file of await machoFiles(root)) await verifySignature(path.join(root, file), options);
      const file = path.join(root, 'BUILD-PROVENANCE.json'), provenance = await read(file);
      if (provenance.distributionSigning?.teamId !== signing.teamId) throw Error('Distribution signing provenance changed');
      provenance.distributionSigning = {...provenance.distributionSigning, notarized:true, submissionId:report.submission.id};
      await fs.writeFile(file, JSON.stringify(provenance, null, 2) + '\n');
    }
    await writeManifest(path.join(payloads, 'desktop'), {sourcePatches:desktopManifest.sourcePatches, availability:desktopManifest.availability});
    await fs.unlink(path.join(payloads, 'service-host', MANIFEST_FILE));
    await writeArtifactManifest(path.join(payloads, 'service-host'), {platform:'darwin', arch:'arm64', sourcePatches:hostManifest.sourcePatches});
    await verifyDesktop(path.join(payloads, 'desktop')); await verifyServiceProfileArtifact(path.join(payloads, 'service-host'));
    // Confirm the source copy remains a valid, unchanged signing result.
    await verifyDesktop(desktop); await verifyServiceProfileArtifact(host);
    if (await fileDigest(path.join(desktop, MANIFEST)) !== signing.desktopManifestSha256 ||
        await fileDigest(path.join(host, MANIFEST_FILE)) !== signing.serviceHostManifestSha256) throw Error('Original signed artifact changed');
    Object.assign(report, {state:'INNER_PAYLOADS_NOTARIZED_NOT_INSTALLED', inputArtifactsUnchanged:true,
      desktopStapled:true, desktopGatekeeperAccepted:true,
      hostNotaryTicket:'online; standalone executables cannot be stapled',
      desktopManifestSha256:await fileDigest(path.join(payloads, 'desktop', MANIFEST)),
      serviceHostManifestSha256:await fileDigest(path.join(payloads, 'service-host', MANIFEST_FILE))});
    await save();
    // Keep the original signing receipt as provenance; final pins are in this receipt.
    await absent(output); await fs.rename(stage, output);
    return {...report, output};
  } catch (error) {
    report.state='NOTARIZATION_FAILED_UNPUBLISHED';
    // execFile errors may contain credential paths/arguments: retain the diagnostic privately.
    await fs.writeFile(path.join(stage,'failure.private.log'),String(error),{mode:0o600});
    await save(); throw Error('Payload notarization failed; diagnostic retained in the owned staging directory');
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const {values} = parseArgs({options:{input:{type:'string'},output:{type:'string'},key:{type:'string'},'key-id':{type:'string'},issuer:{type:'string'}}});
  console.log(JSON.stringify(await notarizeManagedPayloads({input:values.input,output:values.output,key:values.key,keyId:values['key-id'],issuer:values.issuer})));
}
