/** Private shared structural gates. Passing these is NOT signature verification/adoption. */
import fs from 'node:fs/promises';import path from 'node:path';
import {MANIFEST,digest,fileDigest,inventory,validateTargetEntries,UPSTREAM}from './artifact-data.mjs';
import {NAMESPACE}from './descriptor.mjs';
import {desktopTarget,verifyElectronExecutable} from './targets.mjs';
export async function verifyArtifactStructure(root, { expectedManifestSha256,allowQA=false,nativeKeychainQaPlan=null,expectedTarget='darwin-arm64' } = {}) {
 const target=desktopTarget(expectedTarget),portable=target.id!=='darwin-arm64',payload=target.layout.payload;
 if(portable&&(allowQA||nativeKeychainQaPlan!==null))throw Error('Mac QA identity cannot be used for another target');
 const file = path.join(root,MANIFEST), stat = await fs.lstat(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 ** 2) throw Error('Invalid desktop manifest file');
 const bytes = await fs.readFile(file); if (expectedManifestSha256 && digest(bytes) !== expectedManifestSha256) throw Error('Desktop manifest trust digest mismatch');
 const manifest = JSON.parse(bytes),nativeQA=nativeKeychainQaPlan!==null; const allowedKind=nativeQA?manifest.kind==='blackcrab-managed-desktop-native-keychain-qa':(manifest.kind==='blackcrab-managed-desktop'||(allowQA&&manifest.kind==='blackcrab-managed-desktop-qa'&&Array.isArray(manifest.qaPolicy))); const expectedNamespace=nativeQA?nativeKeychainQaPlan.identity.namespace:NAMESPACE; if (manifest.format !== (portable?2:1) || (portable?manifest.target!==target.id:Object.hasOwn(manifest,'target')) || !allowedKind || JSON.stringify(manifest.namespace) !== JSON.stringify(expectedNamespace) || JSON.stringify(manifest.upstream) !== JSON.stringify(UPSTREAM) || JSON.stringify(manifest.electron) !== JSON.stringify(target.electron)) throw Error('Desktop provenance/namespace mismatch');
 if(manifest.kind==='blackcrab-managed-desktop'&&Object.hasOwn(manifest,'qaPolicy'))throw Error('QA policy is not a production package');
 const registry = JSON.parse(await fs.readFile(new URL('./patches/registry.json',import.meta.url),'utf8'));
 if (JSON.stringify(manifest.sourcePatches) !== JSON.stringify(registry.map(({id,sha256})=>({id,sha256})))) throw Error('Desktop patch provenance mismatch');
 if(await fileDigest(path.join(root,'source-patches/registry.json'))!==await fileDigest(new URL('./patches/registry.json',import.meta.url)))throw Error('Packaged source registry differs from reviewed before/after records');
 if(manifest.kind==='blackcrab-managed-desktop-qa'){const policy=JSON.parse(await fs.readFile(path.join(root,'qa-policy/registry.json'),'utf8'));if(JSON.stringify(policy)!==JSON.stringify(manifest.qaPolicy))throw Error('QA policy registry differs');const payload=policy.find(p=>p.target==='apps/desktop/src/app/ManagedQA.ts');if(!payload||await fileDigest(path.join(root,'qa-policy/ManagedQA.ts'))!==payload.afterSha256)throw Error('QA policy payload differs');}
 for(const patch of registry)if(await fileDigest(path.join(root,'source-patches',patch.file))!==patch.sha256)throw Error('Packaged desktop source patch/payload differs');
 if(nativeQA){const{verifyNativeKeychainQaEvidence}=await import('./native-keychain-qa.mjs');await verifyNativeKeychainQaEvidence(root,manifest,nativeKeychainQaPlan);}
 const assets=JSON.parse(await fs.readFile(new URL('./assets/registry.json',import.meta.url),'utf8'));for(const asset of assets)if(await fileDigest(path.join(root,payload,asset.target))!==asset.afterSha256)throw Error('Packaged Blackcrab branding asset mismatch');
 if (!Array.isArray(manifest.files) || manifest.files.length > 50000) throw Error('Invalid desktop manifest inventory'); validateTargetEntries(manifest.files,target.id);
 if (JSON.stringify(await inventory(root,{targetId:target.id})) !== JSON.stringify(manifest.files)) throw Error('Desktop artifact integrity mismatch');
 if(!allowQA&&manifest.files.some(e=>e.path==='qa-policy'||e.path.startsWith('qa-policy/')))throw Error('QA artifact cannot be adopted as production');
 const packageJson=JSON.parse(await fs.readFile(path.join(root,payload,'package.json'),'utf8'));if(packageJson.blackcrabManagedClient!==(nativeQA?'native-keychain-qa':manifest.kind==='blackcrab-managed-desktop-qa'?'qa':'production'))throw Error('Desktop application role/provenance mismatch');
 const required = [target.layout.executable,...['package.json','apps/desktop/dist-electron/main.cjs','apps/desktop/dist-electron/preload.cjs','apps/server/dist/client/index.html'].map(p=>path.posix.join(payload,p)),'LICENSE.upstream','LICENSE.electron','BUILD-PROVENANCE.json'];
 if(portable)required.push(path.posix.join(payload,'apps/desktop/dist-electron/boot.cjs'),'THIRD-PARTY-NOTICES.web.json','THIRD-PARTY-NOTICES.desktop.json');
 for (const name of required) if (!manifest.files.some(e=>e.path===name&&e.type==='file')) throw Error(`Desktop package missing ${name}`);
 if(portable){
  await verifyElectronExecutable(path.join(root,target.layout.executable),target.id);
  if(target.electron.platform==='linux'&&!manifest.files.find(e=>e.path===target.layout.executable).executable)throw Error('Linux desktop executable permission missing');
  const provenance=JSON.parse(await fs.readFile(path.join(root,'BUILD-PROVENANCE.json'),'utf8'));
  if(provenance.target!==target.id||JSON.stringify(provenance.electron)!==JSON.stringify(target.electron)||JSON.stringify(provenance.upstream)!==JSON.stringify(UPSTREAM)||JSON.stringify(provenance.namespace)!==JSON.stringify(NAMESPACE)||typeof packageJson.version!=='string'||provenance.appVersion!==packageJson.version||packageJson.main!=='apps/desktop/dist-electron/boot.cjs')throw Error('Desktop target/build provenance mismatch');
 }
 return manifest;
}
