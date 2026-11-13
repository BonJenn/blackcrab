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

export function validateAcceptance(value, revision, {tag, version, draftBuild = false} = {}) {
  // Build the actual signed installer before asserting its GUI/lifecycle behavior.
  // The workflow independently confirms the release is a draft before opting in.
  // Normal publication validation never accepts this state.
  if (value?.state === 'DRAFT_VALIDATION_PENDING') {
    if (draftBuild !== true || value.schema !== 1 || value.sourceRevision !== revision ||
        !/^[a-f0-9]{40}$/.test(revision ?? '') ||
        !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version ?? '') ||
        tag !== `v${version}` || value.tag !== tag || value.checks !== undefined ||
        JSON.stringify(value.deferredChecks) !== JSON.stringify(lifecycleChecks)) {
      throw Error('Pending native validation permits only an explicit source-bound draft build');
    }
    return value.state;
  }
  // The owner's 0.4 manual-testing delivery includes the single corrective
  // 0.4.1 patch for their reported startup failure. Bind that follow-up to the
  // immutable 0.4.0 baseline; do not extend the exception to later releases.
  // This records deferred tests, never a PASSED lifecycle report.
  if (value?.state === 'OWNER_TESTING_AUTHORIZED') {
    const initialRelease = tag === 'v0.4.0' && version === '0.4.0';
    const correctivePatch = tag === 'v0.4.1' && version === '0.4.1' &&
      value.followUpOf === 'v0.4.0' &&
      value.followUpSourceRevision === 'caf57b6fab1b4391836c6635882a15a88edfac0d';
    if (value.schema !== 1 || value.sourceRevision !== revision ||
        !(initialRelease || correctivePatch) || value.tag !== tag ||
        value.authorization !== ownerTestingAuthorization || value.checks !== undefined ||
        JSON.stringify(value.deferredChecks) !== JSON.stringify(lifecycleChecks)) {
      throw Error('Owner testing authorization must match the 0.4 release or its bound 0.4.1 correction and source');
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

async function sourceOptions(tag, draftBuild = false) {
  const config = await json(path.join(repository, 'src-tauri/tauri.conf.json'));
  const pkg = await json(path.join(repository, 'package.json'));
  if (pkg.version !== config.version || config.identifier !== 'com.bonjenn.blackcrab') throw Error('Root package versions or identity differ');
  const revision = (await exec('git', ['rev-parse', 'HEAD'], {cwd:repository})).stdout.trim();
  const dirty = (await exec('git', ['status', '--porcelain', '--untracked-files=normal'], {cwd:repository})).stdout;
  if (dirty) throw Error('Release preparation requires a clean committed checkout');
  await exec('git', ['merge-base', '--is-ancestor', revision, 'origin/stage'], {cwd:repository});
  return {revision, tag, version:config.version, identity:process.env.APPLE_SIGNING_IDENTITY, teamId:process.env.APPLE_TEAM_ID, draftBuild};
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

/** Keep draft-build evidence, real acceptance and the release-specific owner instruction distinct. */
export async function packReleaseInputs({desktop, serviceHost, acceptance, output, tag, draftBuild = false}) {
  const options = await sourceOptions(tag, draftBuild);
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
  delete inputs.draftBuild;
  await fs.writeFile(path.join(payloads,'release-inputs.json'), JSON.stringify(inputs,null,2)+'\n');
  await validateDirectory(payloads,options);
  const archive = path.join(stage,'blackcrab-managed-payloads.zip');
  await exec('/usr/bin/ditto',['-c','-k',payloads,archive],{timeout:300000});
  // Exclusive copy supports an external-volume destination and refuses replacement.
  await fs.copyFile(archive,output,fs.constants.COPYFILE_EXCL);
  const digest=await fileDigest(output);
  if(digest!==await fileDigest(archive))throw Error('Published release-input copy differs');
  await fs.rm(stage,{recursive:true});
  return {state:acceptanceState === 'PASSED' ? 'ACCEPTED_RELEASE_INPUTS_PREPARED' : acceptanceState === 'DRAFT_VALIDATION_PENDING' ? 'DRAFT_RELEASE_INPUTS_PREPARED' : 'OWNER_TEST_RELEASE_INPUTS_PREPARED',sha256:digest,output:path.resolve(output),sourceRevision:options.revision};
}

/** The workflow supplies the reviewed archive hash independently of the download. */
export async function unpackReleaseInputs({archive, sha, output, tag, draftBuild = false}) {
  if(!sha256(sha)||await fileDigest(archive)!==sha)throw Error('Downloaded release-input archive differs');
  const options = await sourceOptions(tag, draftBuild);
  // The digest identifies our own reviewed archive, not an arbitrary third-party zip.
  await fs.mkdir(output,{mode:0o700});
  await exec('/usr/bin/ditto',['-x','-k',archive,output],{timeout:300000});
  await validateDirectory(output,options);
  return {state:'VERIFIED_MANAGED_RELEASE_INPUTS',output:path.resolve(output),sourceRevision:options.revision};
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const {values}=parseArgs({options:{mode:{type:'string'},desktop:{type:'string'},'service-host':{type:'string'},acceptance:{type:'string'},archive:{type:'string'},sha:{type:'string'},output:{type:'string'},tag:{type:'string'},'draft-build':{type:'boolean',default:false}}});
 if(!['pack','unpack'].includes(values.mode))throw Error('Choose pack or unpack');
 const result=values.mode==='pack'?await packReleaseInputs({desktop:values.desktop,serviceHost:values['service-host'],acceptance:values.acceptance,output:values.output,tag:values.tag,draftBuild:values['draft-build']}):await unpackReleaseInputs({...values,draftBuild:values['draft-build']});
 console.log(JSON.stringify(result));
}
