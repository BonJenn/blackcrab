/** Developer acceptance preparation, not a production launcher or authenticated source importer.
 * sourceRoot must come from the existing authenticated pinned-archive producer.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {applyIdentityPatch} from '../identity/index.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const here=new URL('.',import.meta.url);
export async function prepareOwnerExposureProbe({sourceRoot,dependencyCache,outputParent=os.tmpdir()}) {
 if(process.version!=='v26.12.1')throw Error('Use the pinned Node26.12.1 acceptance toolchain');
 for(const value of [sourceRoot,dependencyCache,outputParent])if(typeof value!=='string'||!path.isAbsolute(value))throw Error('Expected absolute acceptance paths');
 const manifest=JSON.parse(await fs.readFile(new URL('source-manifest.json',here)));
 // This audit is additional consistency checking, not a replacement for archive authentication.
 for(const item of manifest.files){const file=path.join(sourceRoot,item.path),stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||sha(await fs.readFile(file))!==item.sha256)throw Error('Pinned owner audit source differs: '+item.path);}
 const pnpm=path.join(dependencyCache,'node_modules/.pnpm');
 const effect=path.join(pnpm,'effect@4.1.2/node_modules/effect');
 const platform=path.join(pnpm,'@effect+platform-node@4.1.2_bufferutil@4.1.0_effect@4.1.2_redis@6.2.1_utf-8-validate@6.0.6/node_modules/@effect/platform-node');
 const typescript=path.join(pnpm,'typescript@6.0.3/node_modules/typescript');
 const esbuildPath=path.join(pnpm,'esbuild@0.28.2/node_modules/esbuild/lib/main.js');
 for(const [directory,version]of [[effect,'4.1.2'],[platform,'4.1.2'],[typescript,'6.0.3']])if(JSON.parse(await fs.readFile(path.join(directory,'package.json'))).version!==version)throw Error('Acceptance dependency version differs');
 const root=await fs.mkdtemp(path.join(outputParent,'blackcrab-owner-exposure-'));await fs.chmod(root,0o700);
 await fs.writeFile(path.join(root,'.blackcrab-owner-exposure-probe'),'source-only acceptance\n',{mode:0o600});
 const src=path.join(root,'apps/desktop/src');await fs.mkdir(path.join(src,'blackcrab'),{recursive:true});
 for(const entry of await fs.readdir(path.join(sourceRoot,'apps/desktop/src')))await fs.symlink(path.join(sourceRoot,'apps/desktop/src',entry),path.join(src,entry));
 const entry=path.join(src,'blackcrab/ExposureRuntime.ts');await fs.copyFile(new URL('ExposureRuntime.ts',here),entry);
 const policyDir=path.join(root,'owned-shared');await fs.mkdir(policyDir);
 const policy=path.join(policyDir,'managedPolicyFile.ts');
 const policyBytes=applyIdentityPatch(await fs.readFile(path.join(sourceRoot,'packages/shared/src/managedPolicyFile.ts')),'004-own-managed-policy');
 await fs.writeFile(policy,policyBytes);await fs.symlink(path.join(sourceRoot,'packages/shared/src/HostProcess.ts'),path.join(policyDir,'HostProcess.ts'));
 const output=path.join(root,'exposure-runtime.mjs');
 const require=createRequire(import.meta.url),esbuild=require(esbuildPath);
 const built=await esbuild.build({entryPoints:[entry],outfile:output,bundle:true,platform:'node',format:'esm',target:'node26',metafile:true,logLevel:'silent',
  nodePaths:[path.join(pnpm,'node_modules')],alias:{effect:path.join(effect,'dist'),'@effect/platform-node':path.join(platform,'dist'),'@t3tools/shared/managedPolicyFile':policy},external:['ffi-rs'],
  banner:{js:"import {createRequire as __blackcrabRequire} from 'node:module';const require=__blackcrabRequire(import.meta.url);"}});
 const inputs=[];let workspaceInputs=0;
 const effectRoots=new Set();
 for(const key of Object.keys(built.metafile.inputs)){
  const file=path.resolve(key),relative=path.relative(dependencyCache,file);
  if(!relative.startsWith('../')&&!path.isAbsolute(relative)&&relative.startsWith('packages/')){
   workspaceInputs++;if(sha(await fs.readFile(file))!==sha(await fs.readFile(path.join(sourceRoot,relative))))throw Error('Cached workspace input differs: '+relative);
  }
  const match=file.match(/^(.*\/node_modules\/effect)\/dist\//);if(match)effectRoots.add(await fs.realpath(match[1]));
  inputs.push({path:file,sha256:sha(await fs.readFile(file))});
 }
 if(effectRoots.size!==1||!effectRoots.has(await fs.realpath(effect)))throw Error('Owner acceptance bundle has multiple Effect identities');
 const paths={'effect':[path.join(effect,'dist/index.d.ts')],'effect/*':[path.join(effect,'dist/*.d.ts')],'@effect/platform-node/*':[path.join(platform,'dist/*.d.ts')],
  '@t3tools/shared/managedPolicyFile':[policy],'*':[path.join(pnpm,'node_modules/*')]};
 for(const name of ['contracts','shared','tailscale']){paths['@t3tools/'+name]=[path.join(sourceRoot,'packages',name,'src/index.ts')];paths['@t3tools/'+name+'/*']=[path.join(sourceRoot,'packages',name,'src/*')];}
 for(const [key,value]of Object.entries(JSON.parse(await fs.readFile(path.join(effect,'package.json'))).exports))if(value&&key.startsWith('./')&&!key.includes('*')&&value.endsWith('.js'))paths['effect/'+key.slice(2)]=[path.join(effect,value.replace(/\.js$/,'.d.ts'))];
 const tsconfig=path.join(root,'tsconfig.json');await fs.writeFile(tsconfig,JSON.stringify({compilerOptions:{target:'ES2024',module:'ESNext',moduleResolution:'Bundler',allowImportingTsExtensions:true,noEmit:true,strict:true,skipLibCheck:true,resolveJsonModule:true,types:['node'],typeRoots:[path.join(pnpm,'@types+node@24.12.4/node_modules/@types')],paths},files:[entry]},null,2)+'\n');
 await fs.writeFile(path.join(root,'build.json'),JSON.stringify({scope:'developer service adapter acceptance; no production owner transport',upstreamCommit:manifest.commit,archiveSha256:manifest.archiveSha256,workspaceInputs,workspaceDifferences:[],effectRoots:[...effectRoots],policySha256:sha(policyBytes),runtimeSha256:sha(await fs.readFile(output)),inputs},null,2)+'\n');
 return {root,output,tsconfig,typescript:path.join(typescript,'bin/tsc')};
}
