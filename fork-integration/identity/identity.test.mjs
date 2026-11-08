import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {applyIdentityPatch,identityPatchDescriptors} from './index.mjs';
const require=createRequire(import.meta.url),ts=require('typescript'),appRequire=createRequire(new URL('../../apps/mobile/package.json',import.meta.url));
const contracts=await import('@t3tools/contracts');
const registry=JSON.parse(fs.readFileSync(new URL('./registry.json',import.meta.url))),sha=b=>createHash('sha256').update(b).digest('hex');
const fixture=name=>fs.readFileSync(new URL('./fixtures/'+name,import.meta.url));
const patched=id=>applyIdentityPatch(fixture(id+'.before.ts'),id).toString();
const sources={remote:patched('001-own-pairing-app-links'),provider:patched('002-own-desktop-provider-return'),mobile:patched('003-own-mobile-pairing-reader'),preview:fixture('deps/preview.ts').toString(),hostClassification:fixture('deps/hostClassification.ts').toString(),threadLinks:fixture('deps/threadLinks.ts').toString(),connectAuth:fixture('deps/connectAuth.ts').toString()};
function modules(sourceSet){const cache={};function load(name){if(cache[name])return cache[name].exports;const module={exports:{}};cache[name]=module;const output=ts.transpileModule(sourceSet[name],{fileName:name+'.ts',reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});assert(!output.diagnostics?.some(d=>d.category===ts.DiagnosticCategory.Error));vm.runInNewContext(output.outputText,{URL,URLSearchParams,module,exports:module.exports,require:(specifier)=>{const local={'./preview.ts':'preview','./hostClassification.ts':'hostClassification','./connectAuth.ts':'connectAuth','./remote.ts':'remote','@t3tools/shared/remote':'remote'}[specifier];if(local)return load(local);if(specifier==='@t3tools/contracts')return contracts;return appRequire(specifier);}},{filename:name+'.js'});return module.exports;}return load;}
const load=modules(sources),remote=load('remote'),provider=load('provider'),mobile=load('mobile');
test('all preserved sources, license, exact patches and effective TypeScript output match provenance',()=>{
 assert.equal(sha(fs.readFileSync(new URL('./LICENSE.upstream',import.meta.url))),registry.licenseSha256);
 for(const [name,record]of Object.entries(registry.fixtures))assert.equal(sha(fixture('deps/'+name+'.ts')),record.sha256);
 for(const record of identityPatchDescriptors()){const before=fixture(record.id+'.before.ts'),after=applyIdentityPatch(before,record);assert.equal(sha(after),record.afterSha256);assert.deepEqual(after,fixture(record.id+'.after.ts'));assert.equal(sha(fs.readFileSync(new URL(record.patch,import.meta.url))),record.sha256);assert.throws(()=>applyIdentityPatch(Buffer.concat([before,Buffer.from('changed')]),record));assert.throws(()=>applyIdentityPatch(before,{...record,afterSha256:'0'.repeat(64)}));}assert.throws(()=>applyIdentityPatch(Buffer.alloc(0),'unknown'));
});
test('encoded own wrappers round-trip through actual shared and mobile readers into unchanged HTTP/WS codecs',()=>{
 for(const direct of ['https://agent.example/pair#token=a%2Bb%26c','http://100.64.0.4:3773/#token=fixture','ws://192.168.1.4:3773/#token=fixture','wss://agent.example/#token=fixture']){const link=remote.buildPairingAppLink(direct);assert(link.startsWith('blackcrab-remote://pair?pairingUrl='));assert.equal(remote.readPairingAppLink(link),direct);assert.equal(mobile.extractPairingUrlFromQrPayload(link),direct);const target=remote.resolveRemotePairingTarget({pairingUrl:mobile.extractPairingUrlFromQrPayload(link)}),original=modules({...sources,remote:fixture('001-own-pairing-app-links.before.ts').toString()})('remote').resolveRemotePairingTarget({pairingUrl:direct});assert.equal(target.httpBaseUrl,original.httpBaseUrl);assert.equal(target.wsBaseUrl,original.wsBaseUrl);assert.equal(target.credential,original.credential);assert.equal(mobile.extractPairingUrlFromQrPayload(direct),direct);}
});
test('own reader rejects lookalikes, userinfo, port, path and ambiguous query/fragment envelopes',()=>{
 const q='pairingUrl='+encodeURIComponent('https://agent.example/#token=fixture');
 for(const bad of ['t3code://pair?'+q,'t3code-dev://pair?'+q,'blackcrab-remote-dev://pair?'+q,'other://pair?'+q,'blackcrab-remote://pair.evil?'+q,'blackcrab-remote://u:pass@pair?'+q,'blackcrab-remote://pair:123?'+q,'blackcrab-remote://pair/path?'+q,'blackcrab-remote://pair?'+q+'&'+q,'blackcrab-remote://pair?'+q+'&next=https://evil.invalid','blackcrab-remote://pair?'+q+'#token=other','blackcrab-remote://pair?pairingUrl=']){assert.equal(remote.readPairingAppLink(bad),null,bad);assert.equal(mobile.extractPairingUrlFromQrPayload(bad),bad);assert.throws(()=>remote.resolveRemotePairingTarget({pairingUrl:bad}));}
 assert.equal(remote.readPairingAppLink('blackcrab-remote://pair/?'+q),'https://agent.example/#token=fixture');
});
test('desktop provider returns use only own schemes with original path/query/hash sanitation',()=>{
 for(const scheme of ['blackcrab','blackcrab-dev']){
 assert.equal(provider.providerAuthReturnUrl(`${scheme}://app/settings/providers?instanceId=i&secret=s&project=p#ignored`),`${scheme}://app/settings/providers?instanceId=i&project=p`);
 assert.equal(provider.providerAuthReturnUrl(`${scheme}://app/welcome?machine=m&token=s#agents:codex-1`),`${scheme}://app/welcome#agents:codex-1`);
 assert.equal(provider.providerAuthReturnUrl(`${scheme}://app/welcome#agents:bad%20value`),`${scheme}://app/welcome`);
 }
 for(const bad of ['blackcrab://app.evil/settings','blackcrab://u:p@app/settings','blackcrab://app:123/settings','blackcrab-dev-evil://app/settings','blackcrab://app/settingsevil','blackcrab://app/settings%2fproviders','blackcrab://app/%77elcome','blackcrab://app/connections/new','blackcrab-remote://settings/providers','blackcrab-remote:///settings/providers','t3code://app/settings','t3code-dev://app/welcome','https://app.t3.codes/settings','https://app.t3.codes.evil/settings','http://127.0.0.1.evil/settings','https://u:p@localhost/settings','javascript:alert(1)'])assert.equal(provider.providerAuthReturnUrl(bad),undefined,bad);
 const original=modules({...sources,provider:fixture('002-own-desktop-provider-return.before.ts').toString()})('provider');
 for(const url of ['http://127.0.0.1:1234/settings?machine=m&junk=x','http://0.0.0.0:1234/settings?machine=m','http://[::1]:1234/welcome#agents:codex','https://localhost/settings/providers?environmentId=e','https://foreign.example/settings'])assert.equal(provider.providerAuthReturnUrl(url),original.providerAuthReturnUrl(url));
});
test('mobile provider auth has no return URL construction and retains explicit callback completion',()=>{
 const source=fixture('deps/mobile-provider-accounts.ts').toString(),ast=ts.createSourceFile('provider.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let start;
 function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='startSignIn')start=node;ts.forEachChild(node,visit);}visit(ast);assert(start);const body=start.getText(ast);assert(body.includes('start(methodId ? { environmentId, input: { instanceId, methodId } } : target)'));assert(!/returnUrl|returnURL|redirect|createURL/.test(body));assert(source.includes('callbackUrl: values.callback!'));assert(source.includes('Final localhost URL'));
});
test('internal t3-thread codec remains untouched by fork identity patches',()=>{
 const thread=load('threadLinks');assert.equal(thread.parseThreadLinkHref('t3-thread://v1/thread-1').threadId,'thread-1');assert.equal(thread.parseThreadLinkHref('t3-thread://v2/env-1/thread-1').environmentId,'env-1');assert(!registry.patches.some(p=>p.target.includes('threadLinks')));
});

test('mutated diff bytes fail closed independently of source and descriptor hashes',async()=>{
 const os=await import('node:os'),path=await import('node:path'),url=await import('node:url');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackcrab-identity-diff-'));
 try{for(const name of ['index.mjs','registry.json'])fs.copyFileSync(new URL('./'+name,import.meta.url),path.join(dir,name));fs.mkdirSync(path.join(dir,'patches'));const record=identityPatchDescriptors()[0];fs.copyFileSync(new URL(record.patch,import.meta.url),path.join(dir,record.patch));fs.appendFileSync(path.join(dir,record.patch),'changed');const isolated=await import(url.pathToFileURL(path.join(dir,'index.mjs')).href);assert.throws(()=>isolated.applyIdentityPatch(fixture(record.id+'.before.ts'),record),/diff changed/);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('owned managed policy paths and registry keep fork administrator boundaries separate',()=>{
 const id='004-own-managed-policy',effective=patched(id),original=fixture(id+'.before.ts').toString();
 const ast=ts.createSourceFile('policy.ts',effective,ts.ScriptTarget.Latest,true);
 const selector=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='managedPolicyPath');
 assert(selector);
 const exported=ts.transpileModule(selector.getText(ast),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};vm.runInNewContext(exported,{module,exports:module.exports});
 const select=module.exports.managedPolicyPath;
 assert.equal(select('darwin'),'/Library/Application Support/Blackcrab/policy.json');
 assert.equal(select('win32'),'C:\\Program Files\\Blackcrab\\policy.json');
 for(const platform of ['linux','freebsd','openbsd'])assert.equal(select(platform),'/etc/blackcrab/policy.json');
 assert(effective.includes('/Library/Managed Preferences/com.blackcrab.desktop.managed.plist'));
 assert(effective.includes('SOFTWARE\\\\Policies\\\\Blackcrab\\\\Blackcrab'));
 for(const external of ['T3Code/policy.json','T3Code\\\\policy.json','/etc/t3code/','com.t3tools.t3code.plist','Policies\\\\T3Tools\\\\T3Code'])assert(!effective.includes(external));
 // Only reviewed namespace/message replacements change: all enforcement/decoding code stays exact.
 let reverted=effective;for(const replacement of [...registry.patches.find(x=>x.id===id).replacements].reverse())reverted=reverted.replace(replacement.after,replacement.before);
 assert.equal(reverted,original);
});
