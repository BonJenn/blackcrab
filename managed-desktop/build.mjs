import fs from 'node:fs/promises';
import { clientCloudConfigFromEnvironment, clientCloudBuildEnvironment } from '../managed-cloud/client-config.mjs';
import path from 'node:path';
import { spawn,execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { prepareSource } from './source.mjs';
import { linkDependencyCache,stageRuntimeDependencies,collectDependencyNotices } from './dependencies.mjs';
import { ELECTRON,UPSTREAM,fileDigest,writeManifest,verifyArtifact } from './artifact.mjs';
import { NAMESPACE } from './descriptor.mjs';
import {restoreWebCache,saveWebCache} from './web-cache.mjs';
import {applyQAPolicy} from './qa/source.mjs';
import {assertCanonicalEffect,assertBundleEffectSingleton} from './runtime-integrity.mjs';
const exec=promisify(execFile),here=fileURLToPath(new URL('.',import.meta.url));
async function absent(file){try{await fs.lstat(file);}catch(error){if(error.code==='ENOENT')return;throw error;}throw Error('Output already exists');}
export async function buildManagedDesktop({archive,cacheDir,output,node,pnpm,electronArchive,dependencyCache,secondaryDependencyCache,qa=false,cloudEnvironment=process.env}){
 const cloud=clientCloudConfigFromEnvironment(cloudEnvironment);
 if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('Managed desktop producer currently certifies darwin-arm64 only');
 for(const value of [archive,cacheDir,output,node,pnpm,electronArchive])if(typeof value!=='string'||!path.isAbsolute(value))throw Error('Pass absolute producer paths');
 await absent(output);await fs.mkdir(cacheDir,{recursive:true});const checkHome=path.join(cacheDir,'toolchain-home');await fs.mkdir(checkHome,{recursive:true,mode:0o700});const checkEnv={HOME:checkHome,PATH:path.dirname(node)+':/usr/bin:/bin:/usr/sbin:/sbin',COREPACK_ENABLE_PROJECT_SPEC:'0',npm_config_userconfig:'/dev/null',npm_config_globalconfig:'/dev/null'};if((await exec(node,['--version'],{env:checkEnv})).stdout.trim()!=='v26.12.1'||(await exec(pnpm,['--version'],{cwd:cacheDir,env:checkEnv})).stdout.trim()!=='12.14.0')throw Error('Desktop requires pinned Node 26.12.1/pnpm 12.14.0');
 if(await fileDigest(electronArchive)!==ELECTRON.archiveSha256)throw Error('Official Electron archive digest mismatch');
 const {source,sourcePatches}=await prepareSource({archive,cacheDir}),work=await fs.mkdtemp(path.join(cacheDir,'blackcrab-desktop-build-'));for(const d of ['home','tmp','logs'])await fs.mkdir(path.join(work,d),{mode:0o700});
 const qaPolicy=qa?await applyQAPolicy(source):undefined;
 const env={PATH:[path.dirname(node),'/usr/bin','/bin','/usr/sbin','/sbin'].join(':'),HOME:path.join(work,'home'),TMPDIR:path.join(work,'tmp'),CI:'1',NODE_ENV:'production',OTEL_SDK_DISABLED:'true',T3CODE_DISABLE_AUTO_UPDATE:'true',T3CODE_DEV_SEED:'0',NODE_COMPILE_CACHE:path.join(work,'compile-cache')};
 Object.assign(env,clientCloudBuildEnvironment(cloud));
 async function step(name,command,args,cwd=source){const file=path.join(work,'logs',name+'.log'),log=await fs.open(file,'wx',0o600);let child;const stop=()=>{if(child?.pid&&child.exitCode===null)try{process.kill(-child.pid,'SIGTERM');}catch{}};process.once('SIGTERM',stop);process.once('SIGINT',stop);try{await new Promise((resolve,reject)=>{child=spawn(command,args,{cwd,env,detached:true,stdio:['ignore',log.fd,log.fd]});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(name+' failed; see '+file)));});}finally{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);await log.close();}}
 let dependencies;if(dependencyCache){dependencies=await linkDependencyCache(source,dependencyCache);if(secondaryDependencyCache)await linkDependencyCache(source,secondaryDependencyCache,{canonicalProducer:dependencyCache});}else{await step('install',pnpm,['--filter','@t3tools/desktop...','--filter','@t3tools/web...','--filter','@t3tools/scripts...','install','--frozen-lockfile','--ignore-scripts','--store-dir',path.join(cacheDir,'pnpm-store')]);dependencies={kind:'frozen-lockfile-integrity-checked-install'};}
 const effectRuntime=await assertCanonicalEffect(source);
 if(!await restoreWebCache(source,cacheDir,{cloud})){await step('web',node,[path.join(source,'node_modules/vite-plus/bin/vp'),'build'],path.join(source,'apps/web'));await saveWebCache(source,cacheDir,{cloud});}
 const effectWeb=await assertBundleEffectSingleton(path.join(source,'apps/web/dist'),effectRuntime.root);
 await step('annotation-css',node,[path.join(source,'apps/desktop/scripts/build-preview-annotation-css.mjs')],path.join(source,'apps/desktop'));
 await step('desktop',node,[path.join(source,'node_modules/vite-plus/bin/vp'),'pack'],path.join(source,'apps/desktop'));
 const effectBundle=await assertBundleEffectSingleton(path.join(source,'apps/desktop/dist-electron'),effectRuntime.root);
 const staging=path.join(work,'artifact');await fs.mkdir(staging);await step('electron-extract','/usr/bin/ditto',['-x','-k',electronArchive,staging]);
 const app=path.join(staging,'Blackcrab.app');await fs.rename(path.join(staging,'Electron.app'),app);const contents=path.join(app,'Contents'),payload=path.join(contents,'Resources/app');await fs.mkdir(payload);
 await fs.rename(path.join(contents,'MacOS/Electron'),path.join(contents,'MacOS/Blackcrab'));
 await fs.cp(path.join(source,'apps/desktop/dist-electron'),path.join(payload,'apps/desktop/dist-electron'),{recursive:true});await fs.cp(path.join(source,'apps/web/dist'),path.join(payload,'apps/server/dist/client'),{recursive:true});
 const assetPatches=JSON.parse(await fs.readFile(path.join(here,'assets/registry.json'),'utf8'));for(const patch of assetPatches){const target=path.join(payload,patch.target),input=path.join(here,'assets',patch.file);if(await fileDigest(target)!==patch.beforeSha256||await fileDigest(input)!==patch.afterSha256)throw Error('Packaged branding asset differs from pinned input');await fs.copyFile(input,target);}
 for(const name of ['resources','prod-resources']){const input=path.join(source,'apps/desktop',name);try{await fs.cp(input,path.join(payload,'apps/desktop',name),{recursive:true});}catch(error){if(error.code!=='ENOENT')throw error;}}
 await fs.writeFile(path.join(payload,'package.json'),JSON.stringify({name:'blackcrab-managed-desktop',version:'0.1.7',private:true,main:'apps/desktop/dist-electron/boot.cjs',t3codeCommitHash:UPSTREAM.commit,blackcrabManagedClient:qa?'qa':'production'},null,2));
 const {noticeRoots,...availability}=await stageRuntimeDependencies(source,payload);
 for(const file of ['icon.icns','icon.png'])await fs.copyFile(path.join(here,'assets',file),path.join(contents,'Resources',file));
 const appId=NAMESPACE.appId+(qa?'.qa':''),info=path.join(contents,'Info.plist');await step('plist-executable','/usr/libexec/PlistBuddy',['-c','Set :CFBundleExecutable Blackcrab',info]);await step('plist-id','/usr/libexec/PlistBuddy',['-c','Set :CFBundleIdentifier '+appId,info]);for(const key of ['CFBundleName','CFBundleDisplayName'])await step('plist-'+key,'/usr/libexec/PlistBuddy',['-c','Set :'+key+' '+(qa?'Blackcrab QA':'Blackcrab'),info]);await step('plist-icon','/usr/libexec/PlistBuddy',['-c','Set :CFBundleIconFile icon.icns',info]);
 // All helper bundle namespaces change too; no original Electron/T3 keychain group is configured.
 async function plists(dir){for(const name of await fs.readdir(dir)){const f=path.join(dir,name),s=await fs.lstat(f);if(s.isDirectory())await plists(f);else if(name==='Info.plist'&&f!==info){const r=await exec('/usr/libexec/PlistBuddy',['-c','Print :CFBundleIdentifier',f]).catch(()=>null);if(r?.stdout.trim().startsWith('com.github.Electron'))await exec('/usr/libexec/PlistBuddy',['-c','Set :CFBundleIdentifier '+r.stdout.trim().replace('com.github.Electron',appId+'.helper'),f]);}}}await plists(contents);
 await fs.copyFile(path.join(source,'LICENSE'),path.join(staging,'LICENSE.upstream'));await fs.copyFile(path.join(staging,'LICENSE'),path.join(staging,'LICENSE.electron'));await fs.copyFile(path.join(source,'apps/web/dist/third-party-licenses.json'),path.join(staging,'THIRD-PARTY-NOTICES.web.json'));
 await fs.writeFile(path.join(staging,'THIRD-PARTY-NOTICES.desktop.json'),JSON.stringify(await collectDependencyNotices(source,noticeRoots),null,2));
 await fs.cp(path.join(here,'patches'),path.join(staging,'source-patches'),{recursive:true});await fs.cp(path.join(here,'host-requirements'),path.join(staging,'host-requirements'),{recursive:true});
 for(const name of ['runtime','assets'])await fs.cp(path.join(here,name),path.join(staging,name),{recursive:true});for(const name of ['descriptor.mjs','attachment.mjs'])await fs.copyFile(path.join(here,name),path.join(staging,name));
 for(const name of ['access-session.mjs','credential-broker.mjs','browser-peer.mjs'])await fs.copyFile(path.join(here,name),path.join(staging,name));if(qa){await fs.mkdir(path.join(staging,'qa-policy'));await fs.copyFile(path.join(here,'qa/ManagedQA.ts'),path.join(staging,'qa-policy/ManagedQA.ts'));await fs.writeFile(path.join(staging,'qa-policy/registry.json'),JSON.stringify(qaPolicy,null,2));}
 await fs.writeFile(path.join(staging,'BUILD-PROVENANCE.json'),JSON.stringify({upstream:UPSTREAM,electron:ELECTRON,node:'26.12.1',pnpm:'12.14.0',namespace:NAMESPACE,sourcePatches,cloud,dependencies,effectRuntime:{version:effectRuntime.version,checked:effectRuntime.checked,desktop:effectBundle,web:effectWeb},signing:'ad-hoc-local-only; release signing/notarization pending',gates:['owner-control','fork-cloud','distribution-updates-cli','native-browser-transport','native-workflow-certification']},null,2));
 await step('ad-hoc-sign','/usr/bin/codesign',['--force','--deep','--sign','-',app]);await step('verify-sign','/usr/bin/codesign',['--verify','--deep','--strict',app]);
 const manifest=await writeManifest(staging,{sourcePatches,availability,qaPolicy});await verifyArtifact(staging,{allowQA:qa});await fs.mkdir(path.dirname(output),{recursive:true});await absent(output);await fs.rename(staging,output);return {output,sourceRoot:source,buildRoot:work,files:manifest.files.length,availability,qa};
}
