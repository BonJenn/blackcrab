import fs from 'node:fs/promises';import path from 'node:path';
import {NAMESPACE}from './descriptor.mjs';
import {desktopTarget} from './targets.mjs';
import {MANIFEST,digest,fileDigest,inventory,UPSTREAM,ELECTRON}from './artifact-data.mjs';
export{MANIFEST,digest,fileDigest,inventory,validateLinks,relativePath,UPSTREAM,ELECTRON}from './artifact-data.mjs';
import{verifyArtifactStructure}from './artifact-structure.mjs';
export async function writeManifest(root, { sourcePatches, availability,qaPolicy,targetId='darwin-arm64' }) {
 const target=desktopTarget(targetId),portable=targetId!=='darwin-arm64';
 if(portable&&qaPolicy)throw Error('Mac QA policy cannot be used for another target');
 const manifest = { format: portable?2:1,...(portable?{target:target.id}:{}), kind: qaPolicy?'blackcrab-managed-desktop-qa':'blackcrab-managed-desktop', namespace: NAMESPACE, upstream: UPSTREAM, electron: target.electron, sourcePatches, availability,...(qaPolicy?{qaPolicy}:{}), files: await inventory(root,{targetId}) };
 await fs.writeFile(path.join(root,MANIFEST), JSON.stringify(manifest,null,2)+'\n'); return manifest;
}

/** Existing production/old-QA API remains unable to recognize the new identity-only kind. */
export async function verifyArtifact(root,{expectedManifestSha256,allowQA=false,expectedTarget='darwin-arm64'}={}){return verifyArtifactStructure(root,{expectedManifestSha256,allowQA,expectedTarget});}
export async function writeNativeKeychainQaManifest(root,{sourcePatches,availability,state}){const{writeNativeKeychainQaEvidence,QA_KIND}=await import('./native-keychain-qa.mjs');const identity=await writeNativeKeychainQaEvidence(root,state);const manifest={format:1,kind:QA_KIND,namespace:identity.namespace,upstream:UPSTREAM,electron:ELECTRON,sourcePatches,availability,nativeKeychainQaIdentity:identity.nativeKeychainQaIdentity,files:await inventory(root)};await fs.writeFile(path.join(root,MANIFEST),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});return manifest;}
/** Full QA verification always includes real codesign; no unsigned or injected verifier option. */
export async function verifyNativeKeychainQaArtifact(root,options){if(!options||Object.keys(options).sort().join(',')!=='expectedManifestSha256,nonce'||typeof options.expectedManifestSha256!=='string'||!/^[a-f0-9]{64}$/.test(options.expectedManifestSha256))throw Error('Explicit native QA nonce and manifest pin required');const{expectedNativeKeychainQaPlan,verifyNativeKeychainQaSignature}=await import('./native-keychain-qa.mjs');const plan=await expectedNativeKeychainQaPlan(options.nonce);const manifest=await verifyArtifactStructure(root,{expectedManifestSha256:options.expectedManifestSha256,nativeKeychainQaPlan:plan});await verifyNativeKeychainQaSignature(root);return manifest;}
