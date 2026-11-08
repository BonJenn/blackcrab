/** Private shared structural gates. Passing these is NOT signature verification/adoption. */
import fs from 'node:fs/promises';import path from 'node:path';
import {MANIFEST,digest,fileDigest,inventory,validateLinks,UPSTREAM,ELECTRON}from './artifact-data.mjs';
import {NAMESPACE}from './descriptor.mjs';
export async function verifyArtifactStructure(root, { expectedManifestSha256,allowQA=false,nativeKeychainQaPlan=null } = {}) {
 const file = path.join(root,MANIFEST), stat = await fs.lstat(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 ** 2) throw Error('Invalid desktop manifest file');
 const bytes = await fs.readFile(file); if (expectedManifestSha256 && digest(bytes) !== expectedManifestSha256) throw Error('Desktop manifest trust digest mismatch');
 const manifest = JSON.parse(bytes),nativeQA=nativeKeychainQaPlan!==null; const allowedKind=nativeQA?manifest.kind==='blackcrab-managed-desktop-native-keychain-qa':(manifest.kind==='blackcrab-managed-desktop'||(allowQA&&manifest.kind==='blackcrab-managed-desktop-qa'&&Array.isArray(manifest.qaPolicy))); const expectedNamespace=nativeQA?nativeKeychainQaPlan.identity.namespace:NAMESPACE; if (manifest.format !== 1 || !allowedKind || JSON.stringify(manifest.namespace) !== JSON.stringify(expectedNamespace) || JSON.stringify(manifest.upstream) !== JSON.stringify(UPSTREAM) || JSON.stringify(manifest.electron) !== JSON.stringify(ELECTRON)) throw Error('Desktop provenance/namespace mismatch');
 if(manifest.kind==='blackcrab-managed-desktop'&&Object.hasOwn(manifest,'qaPolicy'))throw Error('QA policy is not a production package');
 const registry = JSON.parse(await fs.readFile(new URL('./patches/registry.json',import.meta.url),'utf8'));
 if (JSON.stringify(manifest.sourcePatches) !== JSON.stringify(registry.map(({id,sha256})=>({id,sha256})))) throw Error('Desktop patch provenance mismatch');
 if(await fileDigest(path.join(root,'source-patches/registry.json'))!==await fileDigest(new URL('./patches/registry.json',import.meta.url)))throw Error('Packaged source registry differs from reviewed before/after records');
 if(manifest.kind==='blackcrab-managed-desktop-qa'){const policy=JSON.parse(await fs.readFile(path.join(root,'qa-policy/registry.json'),'utf8'));if(JSON.stringify(policy)!==JSON.stringify(manifest.qaPolicy))throw Error('QA policy registry differs');const payload=policy.find(p=>p.target==='apps/desktop/src/app/ManagedQA.ts');if(!payload||await fileDigest(path.join(root,'qa-policy/ManagedQA.ts'))!==payload.afterSha256)throw Error('QA policy payload differs');}
 for(const patch of registry)if(await fileDigest(path.join(root,'source-patches',patch.file))!==patch.sha256)throw Error('Packaged desktop source patch/payload differs');
 if(nativeQA){const{verifyNativeKeychainQaEvidence}=await import('./native-keychain-qa.mjs');await verifyNativeKeychainQaEvidence(root,manifest,nativeKeychainQaPlan);}
 const assets=JSON.parse(await fs.readFile(new URL('./assets/registry.json',import.meta.url),'utf8'));for(const asset of assets)if(await fileDigest(path.join(root,'Blackcrab.app/Contents/Resources/app',asset.target))!==asset.afterSha256)throw Error('Packaged Blackcrab branding asset mismatch');
 if (!Array.isArray(manifest.files) || manifest.files.length > 50000) throw Error('Invalid desktop manifest inventory'); validateLinks(manifest.files);
 if (JSON.stringify(await inventory(root)) !== JSON.stringify(manifest.files)) throw Error('Desktop artifact integrity mismatch');
 if(!allowQA&&manifest.files.some(e=>e.path==='qa-policy'||e.path.startsWith('qa-policy/')))throw Error('QA artifact cannot be adopted as production');
 const packageJson=JSON.parse(await fs.readFile(path.join(root,'Blackcrab.app/Contents/Resources/app/package.json'),'utf8'));if(packageJson.blackcrabManagedClient!==(nativeQA?'native-keychain-qa':manifest.kind==='blackcrab-managed-desktop-qa'?'qa':'production'))throw Error('Desktop application role/provenance mismatch');
 const required = ['Blackcrab.app/Contents/MacOS/Blackcrab','Blackcrab.app/Contents/Resources/app/package.json','Blackcrab.app/Contents/Resources/app/apps/desktop/dist-electron/main.cjs','Blackcrab.app/Contents/Resources/app/apps/desktop/dist-electron/preload.cjs','Blackcrab.app/Contents/Resources/app/apps/server/dist/client/index.html','LICENSE.upstream','LICENSE.electron','BUILD-PROVENANCE.json'];
 for (const name of required) if (!manifest.files.some(e=>e.path===name&&e.type==='file')) throw Error(`Desktop package missing ${name}`);
 return manifest;
}
