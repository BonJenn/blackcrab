// Build the pinned service producer on a native Windows runner. This is an
// integration candidate: no release, no service activation, and no change to
// what the Mac and Linux producers build.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {buildManagedHost} from '../managed-host/build.mjs';
import {UPSTREAM, NODE_VERSION, MANIFEST_FILE} from '../managed-host/artifact.mjs';
import {SERVICE_PROFILE, verifyServiceProfileArtifact} from '../managed-host/service-profile.mjs';

const {values}=parseArgs({options:{root:{type:'string'},pnpm:{type:'string'}}});
if(process.platform!=='win32'||process.arch!=='x64'||process.env.GITHUB_ACTIONS!=='true')throw Error('Disposable native Windows x64 CI runner required');
if(!values.root||!path.isAbsolute(values.root)||!values.pnpm||!path.isAbsolute(values.pnpm)||path.extname(values.pnpm).toLowerCase()!=='.exe')throw Error('Absolute new root and pnpm.exe required');
await fs.mkdir(values.root);
const root=await fs.realpath(values.root);
const report={target:'win32-x64',passed:false,published:false,serviceActivated:false,
  scope:'Actual pinned host compilation and artifact verification only; no helper, archive, service or launch'};
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
  report.passed=true;
  if(process.env.GITHUB_ENV)await fs.appendFile(process.env.GITHUB_ENV,
    `BLACKCRAB_WINDOWS_HOST_ARTIFACT=${report.build.output}\nBLACKCRAB_WINDOWS_HOST_MANIFEST_SHA256=${manifestSha256}\n`);
}catch(error){
  report.error=error.message;process.exitCode=1;
}finally{
  await fs.writeFile(path.join(root,'result.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
}
console.log(JSON.stringify(report));
