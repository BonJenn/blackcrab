import fs from 'node:fs/promises';
import { clientCloudConfigFromEnvironment, clientCloudBuildEnvironment } from '../managed-cloud/client-config.mjs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { prepareSource } from './source.mjs';
import {verifyElectronArchive} from './targets.mjs';
import {stageElectronRuntime} from './runtime-package.mjs';
import {stagePortableMetadata,verifyPortableMetadata} from './portable-metadata.mjs';
import {selectBuildTarget,prepareBuildEnvironment,pnpmCommand,runBuildStep} from './build-platform.mjs';
import { readBlackcrabVersion } from './release-version.mjs';
import { assertOwnedRendererCopy } from './renderer-branding.mjs';
import { linkDependencyCache,stageRuntimeDependencies,collectDependencyNotices } from './dependencies.mjs';
import { UPSTREAM,MANIFEST,fileDigest,writeManifest,verifyArtifact,writeNativeKeychainQaManifest,verifyNativeKeychainQaArtifact } from './artifact.mjs';
import { NAMESPACE } from './descriptor.mjs';
import {restoreWebCache,saveWebCache} from './web-cache.mjs';
import {applyQAPolicy} from './qa/source.mjs';
import {assertCanonicalEffect,assertBundleEffectSingleton} from './runtime-integrity.mjs';
const exec=promisify(execFile),here=fileURLToPath(new URL('.',import.meta.url));
async function absent(file){try{await fs.lstat(file);}catch(error){if(error.code==='ENOENT')return;throw error;}throw Error('Output already exists');}
export async function buildManagedDesktop({archive,cacheDir,output,node,pnpm,electronArchive,dependencyCache,secondaryDependencyCache,qa=false,nativeKeychainQaNonce,buildOnlyTarget,cloudEnvironment=process.env}){
 const cloud=clientCloudConfigFromEnvironment(cloudEnvironment);
 const appVersion=await readBlackcrabVersion();
 if(nativeKeychainQaNonce!==undefined&&(qa||typeof nativeKeychainQaNonce!=='string'||!/^([a-f0-9]{16})$/.test(nativeKeychainQaNonce)))throw Error('Native keychain QA requires a distinct fixednonce mode; old QA is mutually exclusive');
 const target=selectBuildTarget({buildOnlyTarget,qa,nativeKeychainQaNonce}),portable=target.id!=='darwin-arm64';
 for(const value of [archive,cacheDir,output,node,pnpm,electronArchive])if(typeof value!=='string'||!path.isAbsolute(value))throw Error('Pass absolute producer paths');
 await absent(output);await fs.mkdir(cacheDir,{recursive:true});
 const checkHome=await fs.mkdtemp(path.join(cacheDir,'toolchain-home-'));
 const checkEnv=await prepareBuildEnvironment({node,home:checkHome,temporary:path.join(checkHome,'tmp')});
 const pnpmVersion=pnpmCommand(node,pnpm,['--version']);
 if((await exec(node,['--version'],{env:checkEnv,timeout:30_000})).stdout.trim()!=='v26.12.1'||(await exec(pnpmVersion.command,pnpmVersion.args,{cwd:cacheDir,env:checkEnv,timeout:30_000})).stdout.trim()!=='12.14.0')throw Error('Desktop requires pinned Node 26.12.1/pnpm 12.14.0');
 await verifyElectronArchive(electronArchive,target.id);
 const {source,sourcePatches}=await prepareSource({archive,cacheDir}),work=await fs.mkdtemp(path.join(cacheDir,'blackcrab-desktop-build-'));for(const d of ['home','tmp','logs'])await fs.mkdir(path.join(work,d),{mode:0o700});
 const qaPolicy=qa?await applyQAPolicy(source):undefined;
 const nativeQaTools=nativeKeychainQaNonce===undefined?undefined:await import('./native-keychain-qa.mjs');
 const nativeKeychainQaState=nativeQaTools?await nativeQaTools.applyNativeKeychainQaSources(source,nativeKeychainQaNonce):undefined;
 const env={...await prepareBuildEnvironment({node,home:path.join(work,'home'),temporary:path.join(work,'tmp')}),APP_VERSION:appVersion,NODE_ENV:'production',OTEL_SDK_DISABLED:'true',T3CODE_DISABLE_AUTO_UPDATE:'true',T3CODE_DEV_SEED:'0',NODE_COMPILE_CACHE:path.join(work,'compile-cache')};
 Object.assign(env,clientCloudBuildEnvironment(cloud));
 async function step(name,command,args,cwd=source){await runBuildStep({name,command,args,cwd,env,logs:path.join(work,'logs')});}
 let dependencies;if(dependencyCache){dependencies=await linkDependencyCache(source,dependencyCache);if(secondaryDependencyCache)await linkDependencyCache(source,secondaryDependencyCache,{canonicalProducer:dependencyCache});}else{const install=pnpmCommand(node,pnpm,['--filter','@t3tools/desktop...','--filter','@t3tools/web...','--filter','@t3tools/scripts...','--filter','.','install','--prod=false','--frozen-lockfile','--ignore-scripts','--store-dir',path.join(cacheDir,'pnpm-store')]);await step('install',install.command,install.args);dependencies={kind:'frozen-lockfile-integrity-checked-install'};}
 const effectRuntime=await assertCanonicalEffect(source);
 for(const app of ['desktop','web'])await step(app+'-typecheck',node,[path.join(source,'node_modules/@effect/tsgo/dist/effect-tsgo.cjs'),'tsrs','--noEmit'],path.join(source,'apps',app));
 if(!await restoreWebCache(source,cacheDir,{cloud,appVersion})){await step('web',node,[path.join(source,'node_modules/vite-plus/bin/vp'),'build'],path.join(source,'apps/web'));await saveWebCache(source,cacheDir,{cloud,appVersion});}
 await assertOwnedRendererCopy(path.join(source,'apps/web/dist'));
 const effectWeb=await assertBundleEffectSingleton(path.join(source,'apps/web/dist'),effectRuntime.root);
 await step('annotation-css',node,[path.join(source,'apps/desktop/scripts/build-preview-annotation-css.mjs')],path.join(source,'apps/desktop'));
 await step('desktop',node,[path.join(source,'node_modules/vite-plus/bin/vp'),'pack'],path.join(source,'apps/desktop'));
 const effectBundle=await assertBundleEffectSingleton(path.join(source,'apps/desktop/dist-electron'),effectRuntime.root);
 // Keep the final rename on the output filesystem when the build cache is on another volume.
 await fs.mkdir(path.dirname(output),{recursive:true});
 const staging=await fs.mkdtemp(path.join(path.dirname(output),'.blackcrab-desktop-artifact-'));
 const runtime=await stageElectronRuntime({archive:electronArchive,root:staging,targetId:target.id});
 const app=runtime.appBundle,contents=app?path.join(app,'Contents'):null,payload=runtime.payload;
 await fs.cp(path.join(source,'apps/desktop/dist-electron'),path.join(payload,'apps/desktop/dist-electron'),{recursive:true});await fs.cp(path.join(source,'apps/web/dist'),path.join(payload,'apps/server/dist/client'),{recursive:true});
 const assetPatches=JSON.parse(await fs.readFile(path.join(here,'assets/registry.json'),'utf8'));for(const patch of assetPatches){const target=path.join(payload,patch.target),input=path.join(here,'assets',patch.file);if(await fileDigest(target)!==patch.beforeSha256||await fileDigest(input)!==patch.afterSha256)throw Error('Packaged branding asset differs from pinned input');await fs.copyFile(input,target);}
 for(const name of ['resources','prod-resources']){const input=path.join(source,'apps/desktop',name);try{await fs.cp(input,path.join(payload,'apps/desktop',name),{recursive:true});}catch(error){if(error.code!=='ENOENT')throw error;}}
 await fs.writeFile(path.join(payload,'package.json'),JSON.stringify({name:'blackcrab-managed-desktop',version:appVersion,private:true,main:'apps/desktop/dist-electron/boot.cjs',t3codeCommitHash:UPSTREAM.commit,blackcrabManagedClient:qa?'qa':'production'},null,2));
 const {noticeRoots,...availability}=await stageRuntimeDependencies(source,payload,{targetId:target.id});
 if(!portable){
 for(const file of ['icon.icns','icon.png'])await fs.copyFile(path.join(here,'assets',file),path.join(contents,'Resources',file));
 const appId=NAMESPACE.appId+(qa?'.qa':''),info=path.join(contents,'Info.plist');await step('plist-executable','/usr/libexec/PlistBuddy',['-c','Set :CFBundleExecutable Blackcrab',info]);await step('plist-id','/usr/libexec/PlistBuddy',['-c','Set :CFBundleIdentifier '+appId,info]);for(const key of ['CFBundleName','CFBundleDisplayName'])await step('plist-'+key,'/usr/libexec/PlistBuddy',['-c','Set :'+key+' '+(qa?'Blackcrab QA':'Blackcrab'),info]);await step('plist-icon','/usr/libexec/PlistBuddy',['-c','Set :CFBundleIconFile icon.icns',info]);
 for(const key of ['CFBundleShortVersionString','CFBundleVersion'])await step('plist-'+key,'/usr/libexec/PlistBuddy',['-c','Set :'+key+' '+appVersion,info]);
 if(nativeKeychainQaState)await nativeQaTools.applyNativeKeychainQaPackage(staging,nativeKeychainQaState);
 const helperAppId=nativeKeychainQaState?.identity.namespace.appId??appId;
 // All helper bundle namespaces change too; no original Electron/T3 keychain group is configured.
 async function plists(dir){for(const name of await fs.readdir(dir)){const f=path.join(dir,name),s=await fs.lstat(f);if(s.isDirectory())await plists(f);else if(name==='Info.plist'&&f!==info){const r=await exec('/usr/libexec/PlistBuddy',['-c','Print :CFBundleIdentifier',f]).catch(()=>null);if(r?.stdout.trim().startsWith('com.github.Electron'))await exec('/usr/libexec/PlistBuddy',['-c','Set :CFBundleIdentifier '+r.stdout.trim().replace('com.github.Electron',helperAppId+'.helper'),f]);}}}await plists(contents);
 } else {
  await stagePortableMetadata({root:staging,targetId:target.id,version:appVersion,source});
  await verifyPortableMetadata({root:staging,targetId:target.id,version:appVersion,source});
 }
 await fs.copyFile(path.join(source,'LICENSE'),path.join(staging,'LICENSE.upstream'));await fs.copyFile(path.join(staging,'LICENSE'),path.join(staging,'LICENSE.electron'));await fs.copyFile(path.join(source,'apps/web/dist/third-party-licenses.json'),path.join(staging,'THIRD-PARTY-NOTICES.web.json'));
 await fs.writeFile(path.join(staging,'THIRD-PARTY-NOTICES.desktop.json'),JSON.stringify(await collectDependencyNotices(source,noticeRoots),null,2));
 await fs.cp(path.join(here,'patches'),path.join(staging,'source-patches'),{recursive:true});await fs.cp(path.join(here,'host-requirements'),path.join(staging,'host-requirements'),{recursive:true});
 for(const name of ['runtime','assets'])await fs.cp(path.join(here,name),path.join(staging,name),{recursive:true});for(const name of ['descriptor.mjs','attachment.mjs'])await fs.copyFile(path.join(here,name),path.join(staging,name));
 for(const name of ['access-session.mjs','credential-broker.mjs','browser-peer.mjs','update-client.mjs','lifecycle.mjs'])await fs.copyFile(path.join(here,name),path.join(staging,name));if(qa){await fs.mkdir(path.join(staging,'qa-policy'));await fs.copyFile(path.join(here,'qa/ManagedQA.ts'),path.join(staging,'qa-policy/ManagedQA.ts'));await fs.writeFile(path.join(staging,'qa-policy/registry.json'),JSON.stringify(qaPolicy,null,2));}
 await fs.writeFile(path.join(staging,'BUILD-PROVENANCE.json'),JSON.stringify({appVersion,...(portable?{target:target.id,buildOnly:true}:{}),upstream:UPSTREAM,electron:target.electron,node:'26.12.1',pnpm:'12.14.0',namespace:nativeKeychainQaState?.identity.namespace??NAMESPACE,sourcePatches,cloud,dependencies,...(nativeKeychainQaState?{nativeKeychainQaIdentity:nativeKeychainQaState.identity}:{}),effectRuntime:{version:effectRuntime.version,checked:effectRuntime.checked,desktop:effectBundle,web:effectWeb},signing:portable?'unsigned-build-only; distribution verification pending':'ad-hoc-local-only; release signing/notarization pending',gates:['owner-control','fork-cloud','distribution-updates-cli','native-browser-transport','native-workflow-certification']},null,2));
 if(!portable){await step('ad-hoc-sign','/usr/bin/codesign',['--force','--deep','--sign','-',app]);await step('verify-sign','/usr/bin/codesign',['--verify','--deep','--strict',app]);}
 const manifest=nativeKeychainQaState?await writeNativeKeychainQaManifest(staging,{sourcePatches,availability,state:nativeKeychainQaState}):await writeManifest(staging,{sourcePatches,availability,qaPolicy,targetId:target.id});if(nativeKeychainQaState)await verifyNativeKeychainQaArtifact(staging,{nonce:nativeKeychainQaNonce,expectedManifestSha256:await fileDigest(path.join(staging,MANIFEST))});else await verifyArtifact(staging,{allowQA:qa,expectedTarget:target.id});await fs.mkdir(path.dirname(output),{recursive:true});await absent(output);await fs.rename(staging,output);return {output,target:target.id,buildOnly:portable,sourceRoot:source,buildRoot:work,files:manifest.files.length,availability,qa,...(nativeKeychainQaState?{nativeKeychainQa:true,namespace:nativeKeychainQaState.identity.namespace}:{} )};
}
