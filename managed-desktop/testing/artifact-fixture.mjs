/** Synthetic workspace payload for verifier tests, never a product or release. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {desktopTarget} from '../targets.mjs';
import {writeManifest, UPSTREAM} from '../artifact.mjs';
import {NAMESPACE} from '../descriptor.mjs';

export async function artifactFixture(root,targetId,{runtimeAlreadyStaged=false}={}) {
 const target=desktopTarget(targetId),payload=target.layout.payload;
 async function put(name,bytes){const file=path.join(root,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);}
 if(!runtimeAlreadyStaged){
  const header=Buffer.alloc(128);
  if(targetId==='linux-x64'){header.set([0x7f,0x45,0x4c,0x46,2,1]);header.writeUInt16LE(62,18);}
  else if(targetId==='win32-x64'){header.writeUInt16LE(0x5a4d,0);header.writeUInt32LE(64,0x3c);header.writeUInt32LE(0x00004550,64);header.writeUInt16LE(0x8664,68);}
  else throw Error('Fixture only supports Windows/Linux');
  await put(target.layout.executable,header);
  await fs.chmod(path.join(root,target.layout.executable),0o755);
 }
 const pkg={name:'blackcrab-artifact-test-fixture',version:'0.0.0-test',main:'apps/desktop/dist-electron/boot.cjs',blackcrabManagedClient:'production'};
 await put(path.posix.join(payload,'package.json'),JSON.stringify(pkg));
 // Role above exercises the production structural check only. This code has no
 // workspace, host, credentials or provider commands, and the fixture is deleted.
 for(const name of ['boot.cjs','main.cjs','preload.cjs'])await put(path.posix.join(payload,'apps/desktop/dist-electron',name),'module.exports = { fixture: true };\n');
 await put(path.posix.join(payload,'apps/server/dist/client/index.html'),'<p>Synthetic artifact verifier fixture</p>');
 const registry=JSON.parse(await fs.readFile(new URL('../patches/registry.json',import.meta.url),'utf8'));
 await put('source-patches/registry.json',await fs.readFile(new URL('../patches/registry.json',import.meta.url)));
 for(const record of registry)await put(path.posix.join('source-patches',record.file),await fs.readFile(new URL('../patches/'+record.file,import.meta.url)));
 const assets=JSON.parse(await fs.readFile(new URL('../assets/registry.json',import.meta.url),'utf8'));
 for(const asset of assets)await put(path.posix.join(payload,asset.target),await fs.readFile(new URL('../assets/'+asset.file,import.meta.url)));
 await put('LICENSE.upstream',await fs.readFile(new URL('../../LICENSE',import.meta.url)));
 await put('LICENSE.electron',runtimeAlreadyStaged?await fs.readFile(path.join(root,'LICENSE')):'TEST FIXTURE: no executable runtime');
 for(const name of ['THIRD-PARTY-NOTICES.web.json','THIRD-PARTY-NOTICES.desktop.json'])await put(name,'[]');
 await put('BUILD-PROVENANCE.json',JSON.stringify({target:targetId,electron:target.electron,upstream:UPSTREAM,namespace:NAMESPACE,appVersion:pkg.version,scope:'synthetic verifier fixture; not a release'}));
 return writeManifest(root,{targetId,sourcePatches:registry.map(({id,sha256})=>({id,sha256})),availability:{scope:'synthetic fixture'}});
}
