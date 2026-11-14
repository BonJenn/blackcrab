// Build the existing pinned service producer on a native Linux runner. This is
// an integration candidate, not a release or a change to the Mac producer freeze.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {buildManagedHost} from '../managed-host/build.mjs';
import {BuildLifecycle} from '../managed-host/build-lifecycle.mjs';
import {controlledCommand} from '../managed-host/controlled-process.mjs';
import {UPSTREAM, NODE_VERSION, MANIFEST_FILE} from '../managed-host/artifact.mjs';
import {SERVICE_PROFILE, verifyServiceProfileArtifact} from '../managed-host/service-profile.mjs';
import {prepareManagedNativeResources} from './managed-native-resources.mjs';
import {prepareServiceIssuer} from './prepare-service-issuer.mjs';

const {values}=parseArgs({options:{root:{type:'string'},pnpm:{type:'string'}}});
if(process.platform!=='linux'||process.arch!=='x64'||process.env.GITHUB_ACTIONS!=='true')throw Error('Disposable native Linux x64 CI runner required');
if(!values.root||!path.isAbsolute(values.root)||!values.pnpm||!path.isAbsolute(values.pnpm))throw Error('Absolute new root and pnpm executable required');
await fs.mkdir(values.root,{mode:0o700});
const root=await fs.realpath(values.root), control=new BuildLifecycle();
const report={target:'linux-x64',passed:false,published:false,serviceActivated:false,
  scope:'Actual pinned host compilation, native helper and archive verification; lifecycle acceptance runs separately'};
const environment=Object.fromEntries(['PATH','HOME','LANG','LC_ALL','CARGO_HOME','RUSTUP_HOME'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
Object.assign(environment,{CI:'true',CARGO_PROFILE_RELEASE_DEBUG:'0',CARGO_BUILD_JOBS:'2'});
const cancel=()=>{void control.cancel('CI-build-interrupted').catch(()=>{});};
process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
const deadline=setTimeout(cancel,75*60*1000);
let resources,issuer;
async function download(url,file){
  const response=await fetch(url,{signal:AbortSignal.any([control.signal,AbortSignal.timeout(180000)])});
  if(!response.ok||!response.body)throw Error('Pinned build input download failed');
  const handle=await fs.open(file,'wx',0o600);let size=0;
  try{for await(const chunk of response.body){size+=chunk.length;if(size>512*1024**2)throw Error('Build input exceeds bound');await handle.writeFile(chunk);}}finally{await handle.close();}
}
try{
  const archive=path.join(root,'source.tar.gz'),nodeLicense=path.join(root,'LICENSE.node');
  await download(`https://api.github.com/repos/${UPSTREAM.repository}/tarball/${UPSTREAM.commit}`,archive);
  await download(`https://raw.githubusercontent.com/nodejs/node/v${NODE_VERSION}/LICENSE`,nodeLicense);
  report.nodeLicenseSha256=createHash('sha256').update(await fs.readFile(nodeLicense)).digest('hex');
  report.build=await buildManagedHost({archive,nodeLicense,cacheDir:path.join(root,'cache'),output:path.join(root,'artifact'),
    node:process.execPath,pnpm:values.pnpm,profile:SERVICE_PROFILE,environment,cloudEnvironment:{},processControl:control});
  const manifest=await verifyServiceProfileArtifact(report.build.output,{platform:'linux',arch:'x64'});
  report.artifact={files:manifest.files.length,syntheticPayload:false,
    manifestSha256:createHash('sha256').update(await fs.readFile(path.join(report.build.output,MANIFEST_FILE))).digest('hex')};
  resources=await prepareManagedNativeResources({serviceHost:report.build.output,env:environment,target:'x86_64-unknown-linux-gnu'});
  issuer=await prepareServiceIssuer({env:resources.env,target:'x86_64-unknown-linux-gnu',signed:false,
    run:(command,args,options)=>controlledCommand(command,args,{...options,timeoutMs:options.timeout,label:'service-helper-'+command},control)});
  const hostArchive=path.join(root,'managed-host-payload.tar.gz'),helper=path.join(root,'blackcrab-issuer');
  await fs.copyFile(Object.keys(resources.config.bundle.resources)[0],hostArchive);
  await fs.chmod(hostArchive,0o600);
  await fs.copyFile(issuer.path,helper);await fs.chmod(helper,0o700);
  const pins=Object.fromEntries(Object.entries(resources.env).filter(([key])=>key.startsWith('BLACKCRAB_EMBEDDED_')));
  report.helper={sha256:issuer.sha256,format:'ELF64-x86-64',appleSigned:false};
  report.pins=pins;
  report.processes=await control.finish();report.passed=true;
  if(process.env.GITHUB_ENV)await fs.appendFile(process.env.GITHUB_ENV,
    Object.entries({...pins,BLACKCRAB_TEST_HOST_ARCHIVE:hostArchive,BLACKCRAB_SERVICE_ISSUER_PATH:helper})
      .map(([key,value])=>`${key}=${value}\n`).join(''));
}catch(error){
  report.error=error.message;process.exitCode=1;
  try{report.processes=await control.cancel('CI-host-build-failed');}catch{report.cleanupFailed=true;}
}finally{
  clearTimeout(deadline);process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);
  await issuer?.cleanup();await resources?.cleanup();
  await fs.writeFile(path.join(root,'result.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
}
console.log(JSON.stringify(report));
