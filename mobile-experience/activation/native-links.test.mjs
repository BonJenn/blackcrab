import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {applyRecordedAdapter} from './generator.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)), repo=path.resolve(here,'../..');
const appRequire=createRequire(path.join(repo,'apps/mobile/package.json'));
const ts=createRequire(import.meta.url)('typescript');
const registry=JSON.parse(fs.readFileSync(path.join(here,'registry.json'),'utf8'));
function effective(relative) {
 const before=fs.readFileSync(path.join(repo,'vendor/t3-mobile/apps/mobile',relative));
 const record=registry.adapters.find(r=>r.path===relative);
 return record?applyRecordedAdapter(before,record,record.template?fs.readFileSync(path.join(here,record.template)):undefined).toString():before.toString();
}
function execute(name,source,globals={}) {
 const module={exports:{}};
 const code=ts.transpileModule(source,{fileName:name,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{URL,URLSearchParams,module,exports:module.exports,require:appRequire,...globals},{filename:name});
 return module.exports;
}
const links=execute('appLinking.ts',effective('src/lib/appLinking.ts'));
const pairing=execute('pairing.ts',effective('src/features/connection/pairing.ts'));
function variable(source,name) {
 const file=ts.createSourceFile('effective.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let found;
 function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(file)===name)found=node;ts.forEachChild(node,visit)}visit(file);
 assert(found?.initializer,'missing effective '+name);return found.initializer.getText(file);
}
const app=execute('app-links.ts',`const ownedAppLinkPrefixes=${variable(effective('src/App.tsx'),'ownedAppLinkPrefixes')}; const appLinking=${variable(effective('src/App.tsx'),'appLinking')}; export {appLinking};`,{
 DEFAULT_HOSTED_APP_URL:'',Linking:{createURL:()=> 'blackcrab-remote:///'},shouldHandleAppLink:links.shouldHandleAppLink,hasCloudPublicConfig:()=>false,getAppStateFromPath:()=>undefined,
}).appLinking;

test('effective native App/config/widget use own scheme, without upstream hosted prefixes',()=>{
 const config=JSON.parse(fs.readFileSync(path.join(repo,'apps/mobile/app.json'),'utf8')).expo;
 assert.deepEqual(config.scheme,['blackcrab-remote','blackcrab']);for(const scheme of config.scheme)assert(app.prefixes.includes(scheme+'://'));
 assert(!app.prefixes.some(p=>p.includes('t3code')||p.includes('app.t3.codes')));
 const widget=execute('widget-link.ts','export const url='+variable(effective('src/widgets/AgentActivity.tsx'),'deepLink')+';', {deepLinkRow:{deepLink:'/threads/env/thread'}});
 assert.equal(widget.url,'blackcrab-remote://threads/env/thread');
});
test('effective App guard accepts own routes and rejects foreign, lifecycle and unconfigured hosted app links',()=>{
 for(const input of ['blackcrab-remote://threads/env/thread','blackcrab-remote://connections/new','blackcrab-remote://settings/usage'])assert.equal(app.filter(input),true,input);
 for(const input of ['t3code://threads/env/thread','t3code-dev://threads/env/thread','other-app://threads/env/thread','https://app.t3.codes/threads/env/thread','https://app.t3.codes/pair?host=https://agent.example/#token=fixture','blackcrab-remote://','blackcrab-remote://expo-sharing/file','blackcrab-remote://expo-development-client/?url=x'])assert.equal(app.filter(input),false,input);
 assert.equal(links.shouldHandleAppLink('https://own.blackcrab.example/threads/env/thread',false,[...app.prefixes,'https://own.blackcrab.example/']),true);
 assert.equal(links.shouldHandleAppLink('https://own.blackcrab.example.evil/threads/env/thread',false,[...app.prefixes,'https://own.blackcrab.example/']),false);
 assert.equal(links.shouldHandleAppLink('https://own.blackcrab.example/outside',false,['https://own.blackcrab.example/mobile/']),false);
});
test('own QR wrapper unwraps direct pairing; foreign app wrappers never become SDK pairing targets',()=>{
 const {resolveRemotePairingTarget}=appRequire('@t3tools/shared/remote');
 const direct='https://agent.tailnet.ts.net/pair#token=fixture-token';
 const own='blackcrab-remote://pair?'+new URLSearchParams({pairingUrl:direct});
 const extracted=pairing.extractPairingUrlFromQrPayload(own);assert.equal(extracted,direct);
 assert.equal(pairing.parsePairingUrl(extracted).host,'https://agent.tailnet.ts.net');
 assert.equal(resolveRemotePairingTarget({pairingUrl:extracted}).httpBaseUrl,'https://agent.tailnet.ts.net/');
 for(const scheme of ['t3code','t3code-dev','other-app']) {
  const foreign=scheme+'://pair?'+new URLSearchParams({pairingUrl:direct});
  assert.equal(pairing.extractPairingUrlFromQrPayload(foreign),foreign);
  assert.throws(()=>resolveRemotePairingTarget({pairingUrl:foreign}));
 }
});
test('direct HTTPS/HTTP/WS pairing and local hosted-payload decoding remain supported without activating hosted navigation',()=>{
 const {resolveRemotePairingTarget}=appRequire('@t3tools/shared/remote');
 for(const direct of ['https://agent.example/pair#token=fixture-token','http://100.64.0.4:3773/#token=fixture-token','ws://192.168.1.4:3773/#token=fixture-token','wss://agent.example/#token=fixture-token']) {
  assert.equal(pairing.extractPairingUrlFromQrPayload(direct),direct);
  assert.equal(resolveRemotePairingTarget({pairingUrl:direct}).credential,'fixture-token');
 }
 // Existing QR envelopes are decoded locally into a direct backend URL; the
 // hosted frontend itself is never a registered native navigation prefix.
 const hosted='https://app.t3.codes/pair?host=https%3A%2F%2Fagent.tailnet.ts.net%2F#token=fixture-token';
 assert.equal(app.filter(hosted),false);
 assert.equal(pairing.parsePairingUrl(hosted).host,'https://agent.tailnet.ts.net');
 assert.equal(resolveRemotePairingTarget({pairingUrl:hosted}).httpBaseUrl,'https://agent.tailnet.ts.net/');
});
test('internal t3-thread references retain their pinned codec and are separate from external app schemes',()=>{
 const {parseThreadLinkHref}=appRequire('@t3tools/shared/threadLinks');
 assert.equal(parseThreadLinkHref('t3-thread://v1/thread-1').threadId,'thread-1');
 assert.equal(parseThreadLinkHref('t3-thread://v2/env-1/thread-1').environmentId,'env-1');
 assert.equal(app.filter('t3-thread://v2/env-1/thread-1'),false);
 assert.equal(registry.adapters.some(a=>a.path==='src/lib/enrichedLinkPresentation.ts'),false);
});


test('desktop app links and configured hosted links reach the original native navigator', () => {
 const configured=execute('configured-app-links.ts',`const ownedAppLinkPrefixes=${variable(effective('src/App.tsx'),'ownedAppLinkPrefixes')}; const appLinking=${variable(effective('src/App.tsx'),'appLinking')}; export {appLinking};`,{
  DEFAULT_HOSTED_APP_URL:'https://app.blackcrab.example',Linking:{createURL:()=> 'blackcrab-remote:///'},shouldHandleAppLink:links.shouldHandleAppLink,hasCloudPublicConfig:()=>true,getAppStateFromPath:()=>undefined,
 }).appLinking;
 for(const input of ['blackcrab://threads/env/thread','blackcrab-remote://threads/env/thread','https://app.blackcrab.example/threads/env/thread','https://app.blackcrab.example/new?prompt=hello'])assert.equal(configured.filter(input),true,input);
 assert(configured.prefixes.includes('blackcrab://'));
 assert(configured.prefixes.includes('https://app.blackcrab.example'));
 for(const input of ['https://app.blackcrab.example.evil/threads/env/thread','https://app.t3.codes/threads/env/thread','blackcrab://','blackcrab://expo-development-client/?url=x','blackcrab://user:private@threads/env/thread'])assert.equal(configured.filter(input),false,input);
 const direct='https://agent.example/pair#token=fixture';
 assert.equal(pairing.extractPairingUrlFromQrPayload('blackcrab://pair?'+new URLSearchParams({pairingUrl:direct})),direct);
});


test('copy prompt uses the hosted origin when configured and an app link in local-only mode', async () => {
 const shared=appRequire('@t3tools/shared/promptLinks');
 for (const origin of ['', 'https://app.blackcrab.example']) {
  const copied=[], notices=[];
  const api=execute('prompt-link-actions.ts',effective('src/features/prompt-links/prompt-link-actions.ts'),{
   require:name=>{
    if(name==='@t3tools/shared/connectAuth')return {DEFAULT_HOSTED_APP_URL:origin};
    if(name==='@t3tools/shared/promptLinks')return {...shared,buildNewThreadLink:input=>shared.buildNewThreadLink({...input,origin})};
    if(name==='../../lib/copyTextWithHaptic')return {tryCopyTextWithHaptic:async value=>{copied.push(value);return true}};
    if(name==='../../components/ui/Dialog')return {alert:(...args)=>notices.push(args)};
    if(name==='../../state/use-composer-drafts'||name==='./prompt-link-model')return {};
    throw Error('Unexpected prompt action dependency: '+name);
   },
  });
  await api.copyPromptLink('Review & explain');
  assert.deepEqual(notices,[]);
  assert.equal(copied.length,1);
  assert.equal(shared.promptLinkAppPath(copied[0],origin),'/new?prompt=Review+%26+explain');
  assert.equal(new URL(copied[0]).protocol,origin?'https:':'blackcrab:');
 }
});
