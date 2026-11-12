/** Developer acceptance preparation, not a production launcher or authenticated source importer.
 * sourceRoot must come from the existing authenticated pinned-archive producer.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {sourceMirror} from '../owned-auth/source-mirror.mjs';
import {applyIdentityPatch} from '../../identity/index.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const here=new URL('.',import.meta.url);
export async function prepareEffectiveConfigProbe({sourceRoot,dependencyCache,outputParent=os.tmpdir()}) {
 if(process.version!=='v26.12.1')throw Error('Use the pinned Node26.12.1 acceptance toolchain');
 for(const value of [sourceRoot,dependencyCache,outputParent])if(typeof value!=='string'||!path.isAbsolute(value))throw Error('Expected absolute acceptance paths');
 const manifest=JSON.parse(await fs.readFile(new URL('../../owner-control/source-manifest.json',here)));
 // This audit is additional consistency checking, not a replacement for archive authentication.
 for(const item of manifest.files){const file=path.join(sourceRoot,item.path),stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||sha(await fs.readFile(file))!==item.sha256)throw Error('Pinned owner audit source differs: '+item.path);}
 const pnpm=path.join(dependencyCache,'node_modules/.pnpm');
 const effect=path.join(pnpm,'effect@4.1.2/node_modules/effect');
 const platform=path.join(pnpm,'@effect+platform-node@4.1.2_bufferutil@4.1.0_effect@4.1.2_redis@6.2.1_utf-8-validate@6.0.6/node_modules/@effect/platform-node');
 const typescript=path.join(pnpm,'typescript@6.0.3/node_modules/typescript');
 const esbuildPath=path.join(pnpm,'esbuild@0.28.2/node_modules/esbuild/lib/main.js');
 for(const [directory,version]of [[effect,'4.1.2'],[platform,'4.1.2'],[typescript,'6.0.3']])if(JSON.parse(await fs.readFile(path.join(directory,'package.json'))).version!==version)throw Error('Acceptance dependency version differs');
 const root=await fs.mkdtemp(path.join(outputParent,'blackcrab-effective-config-'));await fs.chmod(root,0o700);
 await fs.writeFile(path.join(root,'.blackcrab-effective-config-probe'),'source-only acceptance\n',{mode:0o600});
 const {stage,directory}=await sourceMirror(root,sourceRoot);
 const src=path.join(root,'apps/desktop/src');await directory('apps/desktop/src/blackcrab');
 const registry=JSON.parse(await fs.readFile(new URL('registry.json',here)));
 for(const added of registry.addedSources){const bytes=await fs.readFile(new URL(added.file,here));if(sha(bytes)!==added.sha256)throw Error('Effective-config added source changed');await stage(added.path,bytes);}
 const server=path.join(root,'apps/server/src');await directory('apps/server/src/environment');
 const record=registry.patches[0],original=await fs.readFile(path.join(sourceRoot,record.path));if(sha(original)!==record.beforeSha256)throw Error('Original identity source differs');
 const patched=await fs.readFile(new URL('fixtures/ServerEnvironment.after.ts',here));if(sha(patched)!==record.afterSha256||sha(await fs.readFile(new URL(record.file,here)))!==record.sha256)throw Error('Identity reader source changed');
 await stage('apps/server/src/environment/ServerEnvironment.ts',patched);
 const entry=path.join(src,'blackcrab/EffectiveConfigCli.ts');
 const policyDir=path.join(root,'owned-shared');await fs.mkdir(policyDir);
 const policy=path.join(policyDir,'managedPolicyFile.ts');
 const policyBytes=applyIdentityPatch(await fs.readFile(path.join(sourceRoot,'packages/shared/src/managedPolicyFile.ts')),'004-own-managed-policy');
 await fs.writeFile(policy,policyBytes);await fs.symlink(path.join(sourceRoot,'packages/shared/src/HostProcess.ts'),path.join(policyDir,'HostProcess.ts'));
 const output=path.join(root,'effective-config-runtime.mjs');
 const require=createRequire(import.meta.url),esbuild=require(esbuildPath);
 const built=await esbuild.build({entryPoints:[entry],outfile:output,bundle:true,platform:'node',format:'esm',target:'node26',metafile:true,logLevel:'silent',
  nodePaths:[path.join(pnpm,'node_modules')],alias:{effect:path.join(effect,'dist'),'@effect/platform-node':path.join(platform,'dist'),'@t3tools/shared/managedPolicyFile':policy},external:['ffi-rs'],plugins:[{name:'verified-original-workspaces',setup(build){build.onResolve({filter:/^@t3tools\/(contracts|shared|tailscale)(?:\/|$)/},async args=>{if(args.path==='@t3tools/shared/managedPolicyFile')return {path:policy};const match=args.path.match(/^@t3tools\/(contracts|shared|tailscale)(?:\/(.*))?$/);const stem=path.join(sourceRoot,'packages',match[1],'src',match[2]??'index');for(const candidate of [stem+'.ts',path.join(stem,'index.ts')])try{if((await fs.stat(candidate)).isFile())return {path:candidate}}catch{}throw Error('Unknown pinned workspace import '+args.path)})}}],
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
 const tsconfig=path.join(root,'tsconfig.json');await fs.writeFile(tsconfig,JSON.stringify({compilerOptions:{target:'ES2024',module:'ESNext',moduleResolution:'Bundler',allowImportingTsExtensions:true,noEmit:true,strict:true,skipLibCheck:true,resolveJsonModule:true,types:['node'],typeRoots:[path.join(pnpm,'@types+node@24.12.4/node_modules/@types')],paths},files:[entry,path.join(src,'blackcrab/EffectiveConfigRuntime.ts'),path.join(server,'environment/ServerEnvironmentIdentityRead.ts')]},null,2)+'\n');
 await fs.writeFile(path.join(root,'build.json'),JSON.stringify({scope:'candidate original-Effect config reader; no production CLI dispatch/service child',upstreamCommit:manifest.commit,archiveSha256:manifest.archiveSha256,workspaceInputs,workspaceDifferences:[],effectRoots:[...effectRoots],policySha256:sha(policyBytes),runtimeSha256:sha(await fs.readFile(output)),inputs},null,2)+'\n');
 await fs.writeFile(path.join(root,'private-cli.mjs'),"import {runEffectiveConfigPrivateCli} from './effective-config-runtime.mjs'; await runEffectiveConfigPrivateCli();\n");
 return {root,output,entry:path.join(root,'private-cli.mjs'),tsconfig,typescript:path.join(typescript,'bin/tsc')};
}
