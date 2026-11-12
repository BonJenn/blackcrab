import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify, parseArgs} from 'node:util';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {fileDigest, MANIFEST} from '../../managed-desktop/artifact.mjs';
import {MANIFEST_FILE} from '../../managed-host/artifact.mjs';
import {verifyManagedReleasePayloads} from './verify-payloads.mjs';

const exec = promisify(execFile);
const repository = fileURLToPath(new URL('../../', import.meta.url));
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const sha256 = value => /^[a-f0-9]{64}$/.test(value ?? '');
export const lifecycleChecks = Object.freeze([
  'firstLaunch', 'enableService', 'openAndReuseDesktop', 'quitPreservesHost',
  'reopenPreservesIdentityAndCatalog', 'restartReconnects', 'stopStartReconnects', 'cleanup',
]);

export const ownerTestingAuthorization = 'publish the mac release and ill test it myself. this will be version 0.4';

export function validateAcceptance(value, revision, {tag, version} = {}) {
  // Explicit owner instruction for this release only. This records deferred
  // manual tests; it must never manufacture a PASSED lifecycle report.
  if (value?.state === 'OWNER_TESTING_AUTHORIZED') {
    if (value.schema !== 1 || value.sourceRevision !== revision ||
        tag !== 'v0.4.0' || version !== '0.4.0' || value.tag !== tag ||
        value.authorization !== ownerTestingAuthorization || value.checks !== undefined ||
        JSON.stringify(value.deferredChecks) !== JSON.stringify(lifecycleChecks)) {
      throw Error('Owner testing authorization must match the explicit v0.4.0 release and source');
    }
    return value.state;
  }
  if (value?.schema !== 1 || value.state !== 'PASSED' || value.sourceRevision !== revision ||
      lifecycleChecks.some(key => value.checks?.[key] !== true)) {
    throw Error('Completed native lifecycle acceptance for this exact source revision is required');
  }
  return value.state;
}

export function validateReleaseInputs(value, {revision, tag, version, identity, teamId}) {
  if (!/^[a-f0-9]{40}$/.test(revision ?? '') ||
      !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version ?? '') || tag !== `v${version}`) {
    throw Error('Exact committed source and matching stable release tag/version are required');
  }
  if (value?.schema !== 1 || value.target !== 'darwin-arm64' || value.sourceRevision !== revision ||
      value.version !== version || value.tag !== tag || value.bundleIdentifier !== 'com.bonjenn.blackcrab' ||
      value.identity !== identity || value.teamId !== teamId ||
      !sha256(value.desktopManifestSha256) || !sha256(value.serviceHostManifestSha256) ||
      !sha256(value.acceptanceSha256)) throw Error('Managed release inputs do not match the selected source, version, platform or payloads');
}

async function sourceOptions(tag) {
  const config = await json(path.join(repository, 'src-tauri/tauri.conf.json'));
  const pkg = await json(path.join(repository, 'package.json'));
  if (pkg.version !== config.version || config.identifier !== 'com.bonjenn.blackcrab') throw Error('Root package versions or identity differ');
  const revision = (await exec('git', ['rev-parse', 'HEAD'], {cwd:repository})).stdout.trim();
  const dirty = (await exec('git', ['status', '--porcelain', '--untracked-files=normal'], {cwd:repository})).stdout;
  if (dirty) throw Error('Release preparation requires a clean committed checkout');
  await exec('git', ['merge-base', '--is-ancestor', revision, 'origin/stage'], {cwd:repository});
  return {revision, tag, version:config.version, identity:process.env.APPLE_SIGNING_IDENTITY, teamId:process.env.APPLE_TEAM_ID};
}

async function validateDirectory(root, options) {
  const expected = ['desktop', 'native-acceptance.json', 'release-inputs.json', 'service-host'];
  if (JSON.stringify((await fs.readdir(root)).sort()) !== JSON.stringify(expected)) throw Error('Unexpected release payload files');
  const inputs = await json(path.join(root, 'release-inputs.json'));
  validateReleaseInputs(inputs, options);
  const acceptance = path.join(root, 'native-acceptance.json');
  if (await fileDigest(acceptance) !== inputs.acceptanceSha256) throw Error('Native acceptance record differs');
  validateAcceptance(await json(acceptance), options.revision, options);
  const desktop = path.join(root, 'desktop'), serviceHost = path.join(root, 'service-host');
  if (await fileDigest(path.join(desktop, MANIFEST)) !== inputs.desktopManifestSha256 ||
      await fileDigest(path.join(serviceHost, MANIFEST_FILE)) !== inputs.serviceHostManifestSha256) throw Error('Release payload manifest differs');
  await verifyManagedReleasePayloads({desktop, serviceHost, ...options});
  return inputs;
}

/** Preserve real acceptance or the release-specific owner instruction without conflating them. */
export async function packReleaseInputs({desktop, serviceHost, acceptance, output, tag}) {
  const options = await sourceOptions(tag);
  const acceptanceState = validateAcceptance(await json(acceptance), options.revision, options);
  await verifyManagedReleasePayloads({desktop, serviceHost, ...options});
  const stage = await fs.mkdtemp(path.join(path.dirname(path.resolve(output)), '.blackcrab-release-inputs-'));
  await fs.chmod(stage, 0o700);
  const payloads = path.join(stage, 'payloads'); await fs.mkdir(payloads);
  for (const [name, source] of [['desktop',desktop],['service-host',serviceHost]]) {
    await fs.cp(source, path.join(payloads,name), {recursive:true,verbatimSymlinks:true});
  }
  await fs.copyFile(acceptance, path.join(payloads,'native-acceptance.json'));
  const inputs = {schema:1, target:'darwin-arm64', bundleIdentifier:'com.bonjenn.blackcrab', ...options,
    sourceRevision:options.revision,
    desktopManifestSha256:await fileDigest(path.join(desktop,MANIFEST)),
    serviceHostManifestSha256:await fileDigest(path.join(serviceHost,MANIFEST_FILE)),
    acceptanceSha256:await fileDigest(acceptance)};
  delete inputs.revision;
  await fs.writeFile(path.join(payloads,'release-inputs.json'), JSON.stringify(inputs,null,2)+'\n');
  await validateDirectory(payloads,options);
  const archive = path.join(stage,'blackcrab-managed-payloads.zip');
  await exec('/usr/bin/ditto',['-c','-k',payloads,archive],{timeout:300000});
  // Exclusive copy supports an external-volume destination and refuses replacement.
  await fs.copyFile(archive,output,fs.constants.COPYFILE_EXCL);
  const digest=await fileDigest(output);
  if(digest!==await fileDigest(archive))throw Error('Published release-input copy differs');
  await fs.rm(stage,{recursive:true});
  return {state:acceptanceState === 'PASSED' ? 'ACCEPTED_RELEASE_INPUTS_PREPARED' : 'OWNER_TEST_RELEASE_INPUTS_PREPARED',sha256:digest,output:path.resolve(output),sourceRevision:options.revision};
}

/** The workflow supplies the reviewed archive hash independently of the download. */
export async function unpackReleaseInputs({archive, sha, output, tag}) {
  if(!sha256(sha)||await fileDigest(archive)!==sha)throw Error('Downloaded release-input archive differs');
  const options = await sourceOptions(tag);
  // The digest identifies our own reviewed archive, not an arbitrary third-party zip.
  await fs.mkdir(output,{mode:0o700});
  await exec('/usr/bin/ditto',['-x','-k',archive,output],{timeout:300000});
  await validateDirectory(output,options);
  return {state:'VERIFIED_MANAGED_RELEASE_INPUTS',output:path.resolve(output),sourceRevision:options.revision};
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const {values}=parseArgs({options:{mode:{type:'string'},desktop:{type:'string'},'service-host':{type:'string'},acceptance:{type:'string'},archive:{type:'string'},sha:{type:'string'},output:{type:'string'},tag:{type:'string'}}});
 if(!['pack','unpack'].includes(values.mode))throw Error('Choose pack or unpack');
 const result=values.mode==='pack'?await packReleaseInputs({desktop:values.desktop,serviceHost:values['service-host'],acceptance:values.acceptance,output:values.output,tag:values.tag}):await unpackReleaseInputs(values);
 console.log(JSON.stringify(result));
}
