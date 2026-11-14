// Build the real workspace on its native runner. Never activate or publish it.
import fs from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {buildManagedDesktop} from '../managed-desktop/build.mjs';
import {desktopTarget} from '../managed-desktop/targets.mjs';
import {UPSTREAM,MANIFEST,fileDigest,verifyArtifact} from '../managed-desktop/artifact.mjs';
import {verifyPortableMetadata} from '../managed-desktop/portable-metadata.mjs';

const {values}=parseArgs({options:{root:{type:'string'},pnpm:{type:'string'}}});
if(!values.root||!path.isAbsolute(values.root)||!values.pnpm||!path.isAbsolute(values.pnpm))throw Error('Absolute new CI root and pnpm entry required');
const target=desktopTarget(`${process.platform}-${process.arch}`);
if(!['win32-x64','linux-x64'].includes(target.id))throw Error('Native Windows/Linux runner required');
await fs.mkdir(values.root);
const report={target:target.id,scope:'Actual workspace compilation, metadata and complete artifact verification; no native UI, service, installer or release acceptance',passed:false,launched:false,published:false};
async function download(url,file){
 const response=await fetch(url,{signal:AbortSignal.timeout(180_000)});
 if(!response.ok||!response.body)throw Error('Pinned build input download failed');
 const handle=await fs.open(file,'wx',0o600);let size=0;
 try{for await(const chunk of response.body){size+=chunk.length;if(size>512*1024**2)throw Error('Build input exceeds bound');await handle.writeFile(chunk);}}finally{await handle.close();}
}
try{
 const archive=path.join(values.root,'source.tar.gz'),electronArchive=path.join(values.root,'electron.zip');
 await download(`https://api.github.com/repos/${UPSTREAM.repository}/tarball/${UPSTREAM.commit}`,archive);
 await download(target.electron.url,electronArchive);
 const result=await buildManagedDesktop({archive,electronArchive,cacheDir:path.join(values.root,'cache'),output:path.join(values.root,'artifact'),node:process.execPath,pnpm:values.pnpm,buildOnlyTarget:target.id,cloudEnvironment:{}});
 const manifestSha256=await fileDigest(path.join(result.output,MANIFEST));
 const manifest=await verifyArtifact(result.output,{expectedTarget:target.id,expectedManifestSha256:manifestSha256});
 const provenance=JSON.parse(await fs.readFile(path.join(result.output,'BUILD-PROVENANCE.json'),'utf8'));
 if(provenance.buildOnly!==true||!provenance.effectRuntime?.desktop?.sources||!provenance.effectRuntime?.web?.sources)throw Error('Missing actual compile/bundle evidence');
 report.metadata=await verifyPortableMetadata({root:result.output,targetId:target.id,version:provenance.appVersion,source:result.sourceRoot});
 report.artifact={format:manifest.format,files:manifest.files.length,manifestSha256,syntheticPayload:false,appVersion:provenance.appVersion};
 report.payload={};for(const name of ['apps/desktop/dist-electron/boot.cjs','apps/desktop/dist-electron/main.cjs','apps/desktop/dist-electron/preload.cjs','apps/server/dist/client/index.html'])report.payload[name]=await fileDigest(path.join(result.output,target.layout.payload,name));
 report.build=result;report.passed=true;
 if(process.env.GITHUB_ENV)await fs.appendFile(process.env.GITHUB_ENV,`BLACKCRAB_NATIVE_PACKAGE_ROOT=${result.output}\nBLACKCRAB_NATIVE_PACKAGE_SHA256=${manifestSha256}\n`);
}catch(error){report.error=error.message;process.exitCode=1;}
await fs.writeFile(path.join(values.root,'result.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify(report));
