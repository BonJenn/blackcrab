// Build the pinned service producer on a native Windows runner. This is an
// integration candidate: no release, no service activation, and no change to
// what the Mac and Linux producers build.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {buildManagedHost} from '../managed-host/build.mjs';
import {UPSTREAM, NODE_VERSION, MANIFEST_FILE} from '../managed-host/artifact.mjs';
import {SERVICE_PROFILE, verifyServiceProfileArtifact} from '../managed-host/service-profile.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {prepareManagedNativeResources} from './managed-native-resources.mjs';
import {prepareServiceIssuer} from './prepare-service-issuer.mjs';
const exec=promisify(execFile);

const {values}=parseArgs({options:{root:{type:'string'},pnpm:{type:'string'}}});
if(process.platform!=='win32'||process.arch!=='x64'||process.env.GITHUB_ACTIONS!=='true')throw Error('Disposable native Windows x64 CI runner required');
if(!values.root||!path.isAbsolute(values.root)||!values.pnpm||!path.isAbsolute(values.pnpm)||path.extname(values.pnpm).toLowerCase()!=='.exe')throw Error('Absolute new root and pnpm.exe required');
await fs.mkdir(values.root);
const root=await fs.realpath(values.root);
const report={target:'win32-x64',passed:false,published:false,serviceActivated:false,
  scope:'Actual pinned host compilation, archive and native helper; no service activation or launch'};
let resources,issuer;
// The producer runs tools by name. Windows' own tar must come before any
// other on PATH: GNU tar reads "C:" in a path as a remote host.
const system=path.join(process.env.SystemRoot,'System32');
const environment={...process.env,PATH:[system,process.env.PATH].join(path.delimiter),CI:'true',CARGO_PROFILE_RELEASE_DEBUG:'0',CARGO_BUILD_JOBS:'2'};
async function download(url,file){
  const response=await fetch(url,{signal:AbortSignal.timeout(180000)});
  if(!response.ok||!response.body)throw Error('Pinned build input download failed');
  const handle=await fs.open(file,'wx');let size=0;
  try{for await(const chunk of response.body){size+=chunk.length;if(size>512*1024**2)throw Error('Build input exceeds bound');await handle.writeFile(chunk);}}finally{await handle.close();}
}
try{
  const archive=path.join(root,'source.tar.gz'),nodeLicense=path.join(root,'LICENSE.node');
  await download(`https://api.github.com/repos/${UPSTREAM.repository}/tarball/${UPSTREAM.commit}`,archive);
  await download(`https://raw.githubusercontent.com/nodejs/node/v${NODE_VERSION}/LICENSE`,nodeLicense);
  report.nodeLicenseSha256=createHash('sha256').update(await fs.readFile(nodeLicense)).digest('hex');
  // The producer's own PATH is rebuilt from this environment.
  process.env.PATH=environment.PATH;
  report.build=await buildManagedHost({archive,nodeLicense,cacheDir:path.join(root,'cache'),output:path.join(root,'artifact'),
    node:process.execPath,pnpm:values.pnpm,profile:SERVICE_PROFILE,environment,cloudEnvironment:{}});
  const manifest=await verifyServiceProfileArtifact(report.build.output,{platform:'win32',arch:'x64'});
  const manifestSha256=createHash('sha256').update(await fs.readFile(path.join(report.build.output,MANIFEST_FILE))).digest('hex');
  report.artifact={files:manifest.files.length,syntheticPayload:false,entry:manifest.entry,manifestSha256,
    sourcePatches:manifest.sourcePatches.length};
  // Archive the payload as Root will embed it, then build the helper pinned to it.
  resources=await prepareManagedNativeResources({serviceHost:report.build.output,env:environment,target:'x86_64-pc-windows-msvc'});
  // npm is a command script on Windows and needs a shell to start.
  issuer=await prepareServiceIssuer({env:resources.env,target:'x86_64-pc-windows-msvc',signed:false,
    run:(command,args,options)=>exec(command,args,{...options,shell:/\.cmd$/i.test(command)})});
  const hostArchive=path.join(root,'managed-host-payload.tar.gz'),helper=path.join(root,'blackcrab-issuer.exe');
  // On Windows the resource is named relative to src-tauri.
  await fs.copyFile(path.resolve(fileURLToPath(new URL('../src-tauri/',import.meta.url)),Object.keys(resources.config.bundle.resources)[0]),hostArchive);
  await fs.copyFile(issuer.path,helper);
  const pins=Object.fromEntries(Object.entries(resources.env).filter(([key])=>key.startsWith('BLACKCRAB_EMBEDDED_')));
  report.helper={sha256:issuer.sha256,format:'PE-x86-64',authenticodeSigned:false};
  report.pins=pins;
  // The helper is a windowless program that takes exactly one fixed argument.
  // Outside its installed location it must refuse without doing anything.
  const exit=async args=>{try{await exec(helper,args,{timeout:60000});return 0;}catch(error){return error.code;}};
  report.helper.exits={unknownArgument:await exit(['unexpected']),noArgument:await exit([]),notInstalled:await exit(['__blackcrab-service-issuer-v1'])};
  if(report.helper.exits.unknownArgument!==64||report.helper.exits.noArgument!==64||report.helper.exits.notInstalled!==1)throw Error('Helper did not refuse as expected');
  report.passed=true;
  if(process.env.GITHUB_ENV)await fs.appendFile(process.env.GITHUB_ENV,
    Object.entries({...pins,BLACKCRAB_TEST_HOST_ARCHIVE:hostArchive,BLACKCRAB_SERVICE_ISSUER_PATH:helper,
      BLACKCRAB_WINDOWS_HOST_ARTIFACT:report.build.output,BLACKCRAB_WINDOWS_HOST_MANIFEST_SHA256:manifestSha256})
      .map(([key,value])=>`${key}=${value}\n`).join(''));
}catch(error){
  report.error=error.message;process.exitCode=1;
}finally{
  await issuer?.cleanup();await resources?.cleanup();
  await fs.writeFile(path.join(root,'result.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
}
console.log(JSON.stringify(report));
