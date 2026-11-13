import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const ts=createRequire(import.meta.url)('typescript');
const registry=JSON.parse(await fs.readFile(new URL('./patches/registry.json',import.meta.url),'utf8'));
const finalSource=target=>registry.filter(p=>p.target===target).at(-1).replacements.at(-1).after;
function moduleFor(target){
 const exports={};const code=ts.transpileModule(finalSource(target),{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.CommonJS}}).outputText;
 new Function('exports','require',code)(exports,name=>{throw Error('Unexpected runtime import '+name);});return exports;
}
test('theme label is owned without resetting the saved palette identity',()=>{
 const s=finalSource('packages/shared/src/themePalettes.ts');
 assert.match(s,/id: "t3-chat",\s+label: "Rose"/);assert.doesNotMatch(s,/label: "T3/);
});
test('account limit errors retain the real cap and offer account management, without upstream subscriptions',()=>{
 const {relayProtectedErrorMessage}=moduleFor('packages/client-runtime/src/relay/errorPresentation.ts');
 for(const maxTunnels of [0,3,10,100]){
  const s=relayProtectedErrorMessage({_tag:'RelayEnvironmentLinkLimitExceededError',maxTunnels});
  assert.ok(s.includes(String(maxTunnels)));assert.match(s,/Blackcrab/);assert.match(s,/Sharing & access/);
  assert.doesNotMatch(s,/T3|paid|Premier|Pro raises/);
 }
});
test('mobile links point to owned product information, never another app store listing',()=>{
 const s=finalSource('apps/web/src/components/settings/MobileAppSettingsRow.tsx');
 assert.match(s,/https:\/\/www\.blackcrab\.app\/docs/);
 assert.doesNotMatch(s,/t3-code-remote|com\.t3tools|Google Play|store: "App Store"/);
});
test('remaining UI copy changes retain executable identifiers except reviewed behavioral deltas',()=>{
 const structural=new Set(['apps/web/src/components/auth/ConnectAgentSurface.tsx','packages/client-runtime/src/relay/errorPresentation.ts','apps/web/src/components/settings/MobileAppSettingsRow.tsx','apps/web/src/components/HostedEmptyState.tsx']);
 const identifiers=s=>{const t=ts.createSourceFile('copy.tsx',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),a=[];function visit(n){if(ts.isIdentifier(n))a.push(n.text);ts.forEachChild(n,visit);}visit(t);return a;};
 for(const p of registry.filter(p=>p.id.startsWith('blackcrab-product-ui-'))){
  const {before,after}=p.replacements[0];
  if(!structural.has(p.target))assert.deepEqual(identifiers(after),identifiers(before),p.target);
 }
});
