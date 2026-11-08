import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyzeMobileExperience } from './graph.mjs';
import { verifyMobileExperienceGraph } from './verify.mjs';
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mobile-experience-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const put = (name, content) => { const p=path.join(root,name); fs.mkdirSync(path.dirname(p),{recursive:true}); fs.writeFileSync(p,content); };
  put('apps/mobile/package.json', JSON.stringify({name:'@t3tools/mobile', private:true}));
  put('packages/example/package.json', JSON.stringify({name:'@t3tools/example',exports:{'./item': './src/item.ts'},dependencies:{'unused-node-sdk':'1.0.0'}}));
  put('packages/example/src/item.ts', 'export const item = 1;');
  put('apps/mobile/index.ts', 'import { item } from "@t3tools/example/item"; console.log(item);');
  return {root, put};
}
test('deterministic portable graph records exact exports and manifests without unused SDK closure',t=>{
 const {root}=fixture(t),a=analyzeMobileExperience(root); assert.deepEqual(a,analyzeMobileExperience(root));
 assert.equal(a.packages.length,2);assert.equal(a.files.length,2);assert.deepEqual(a.externalNames,[]);
 assert.equal(a.packages.find(x=>x.name==='@t3tools/example').usedExports[0].key,'./item');
 assert.ok(!JSON.stringify(a).includes(root));assert.equal(verifyMobileExperienceGraph(root,a).files,2);
});
test('iOS override, import type query, JSON assets and generated aliases are retained',t=>{
 const {root,put}=fixture(t);put('apps/mobile/index.ts','import "./view"; type X = import("./types").X; import "./asset.json"; import "@t3tools/mobile-device-stream";');
 put('apps/mobile/view.ts','import "node:fs";');put('apps/mobile/view.ios.ts','export {};');put('apps/mobile/types.ts','export type X = string;');put('apps/mobile/asset.json','{"ok":true}');
 const a=analyzeMobileExperience(root);assert.ok(a.files.some(x=>x.path.endsWith('view.ios.ts')));assert.ok(a.files.some(x=>x.path.endsWith('types.ts')&&!x.runtime));assert.ok(a.files.some(x=>x.path.endsWith('asset.json')));
 assert.deepEqual(a.externalNames,['@t3tools/mobile-device-stream']);
});
for(const code of ['import "node:fs";', 'import "unknown-sdk";', 'import(foo);', 'require(name);', 'import "../../../escaped";'])test(`reject unsafe closure: ${code}`,t=>{const {root,put}=fixture(t);put('apps/mobile/index.ts',code);assert.throws(()=>analyzeMobileExperience(root));});
test('reject source symlink',t=>{const {root,put}=fixture(t);put('apps/mobile/index.ts','import "./linked";');fs.symlinkSync(path.join(root,'packages/example/src/item.ts'),path.join(root,'apps/mobile/linked.ts'));assert.throws(()=>analyzeMobileExperience(root),/symbolic link/);});
test('verification detects source, original metadata, and graph tampering',t=>{
 const {root,put}=fixture(t),a=analyzeMobileExperience(root);const changed=structuredClone(a);changed.files[0].sha256='0'.repeat(64);assert.throws(()=>verifyMobileExperienceGraph(root,changed));
 put('packages/example/package.json',JSON.stringify({name:'@t3tools/example',exports:{'./item':'./src/item.ts'},dependencies:{'unused-node-sdk':'2'}}));assert.throws(()=>verifyMobileExperienceGraph(root,a));
 put('packages/example/package.json',JSON.stringify(a.packages.find(x=>x.name==='@t3tools/example').originalManifest));
 put('packages/example/src/item.ts','export const item = 2;');assert.throws(()=>verifyMobileExperienceGraph(root,a));
});

test('reject divergent runtime export targets rather than choosing a platform silently',t=>{const {root,put}=fixture(t);put('packages/example/package.json',JSON.stringify({name:'@t3tools/example',exports:{'./item':{'react-native':'./src/item.ts',default:'./src/other.ts'}}}));put('packages/example/src/other.ts','export {};');assert.throws(()=>analyzeMobileExperience(root),/divergent/);});
test('invalid imported JSON cannot become an opaque retained asset',t=>{const {root,put}=fixture(t);put('apps/mobile/index.ts','import "./asset.json";');put('apps/mobile/asset.json','{broken');assert.throws(()=>analyzeMobileExperience(root));});
