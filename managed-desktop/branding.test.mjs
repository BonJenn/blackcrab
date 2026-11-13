import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const ts=createRequire(import.meta.url)('typescript');
const records=JSON.parse(await fs.readFile(new URL('./patches/registry.json',import.meta.url),'utf8')).filter(p=>p.id.startsWith('blackcrab-ui-copy-'));
const accountRecords=JSON.parse(await fs.readFile(new URL('./patches/registry.json',import.meta.url),'utf8')).filter(p=>p.id.startsWith('blackcrab-owned-account-'));
const after=target=>records.find(p=>p.target.endsWith(target)).replacements[0].after;
function identifiers(source){const tree=ts.createSourceFile('surface.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),result=[];const visit=node=>{if(ts.isIdentifier(node))result.push(node.text);ts.forEachChild(node,visit);};visit(tree);return result;}
test('owned UI copy preserves executable identifiers and original transport contracts',()=>{
 assert.ok(records.length>50);
 const structural=new Set(['WelcomeWizard.tsx','T3AppIcon.tsx','T3Wordmark.tsx']);
 for(const record of records){const {before,after}=record.replacements[0];assert.doesNotMatch(after,/T3 (?:Code|Connect|Account|account)/,record.target);if(!structural.has(record.target.split('/').at(-1)))assert.deepEqual(identifiers(after),identifiers(before),record.target);}
});
test('onboarding and environment selection use the Blackcrab name and supported setup path',()=>{
 const welcome=after('/onboarding/WelcomeWizard.tsx');assert.match(welcome,/title="Set up Blackcrab"/);assert.match(welcome,/aria-label="Blackcrab"/);assert.match(welcome,/Sharing &amp; access/);assert.doesNotMatch(welcome,/npx t3|CommandBlock/);
 assert.match(after('/settings/EnvironmentRow.tsx'),/Blackcrab Connect/);
 assert.match(after('/settings/AddEnvironmentDialog.tsx'),/Add Blackcrab Connect/);
});
test('shared marks render the packaged Blackcrab asset rather than upstream art',()=>{
 for(const file of ['/T3Wordmark.tsx','/T3AppIcon.tsx']){const code=after(file);assert.match(code,/\/apple-touch-icon\.png/);assert.doesNotMatch(code,/t3-black|M33\.4509/);const parsed=ts.createSourceFile(file,code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);assert.equal(parsed.parseDiagnostics.length,0);}
 assert.match(after('/legalLinks.ts'),/https:\/\/www\.blackcrab\.app\/docs#privacy-security/);
});

function loadAccountModule(suffix, mocks) {
 const source=accountRecords.find(p=>p.target.endsWith(suffix)).replacements[0].after;
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2023}}).outputText;
 const exports={}; const require=createRequire(import.meta.url);
 new Function('exports','require',compiled)(exports,name=>{
  if(Object.hasOwn(mocks,name))return mocks[name];
  if(['react','react/jsx-runtime','react-dom'].includes(name))return require(name);
  throw Error('Unexpected account dependency: '+name);
 });
 return exports;
}
test('account navigation exposes owned connections and mobile devices, without upstream subscription pages',()=>{
 const Empty=()=>null;
 const module=loadAccountModule('/T3ConnectAccountPages.tsx',{
  '@clerk/react':{},'lucide-react':{ServerIcon:Empty,SmartphoneIcon:Empty},
  './MobileClientsUserProfilePage':{MobileClientsUserProfilePage:Empty},
  './T3ConnectUserProfilePage':{T3ConnectUserProfilePage:Empty},
 });
 assert.deepEqual(module.T3_CONNECT_ACCOUNT_PAGES.map(p=>p.label),['Mobile clients','Blackcrab Connect']);
 assert.deepEqual(module.T3_CONNECT_ACCOUNT_PAGES.map(p=>p.url),['mobile-clients','t3-connect']);
});
test('a reached tunnel limit keeps account management available without an external purchase action',()=>{
 const module=loadAccountModule('/TunnelUsage.tsx',{
  'lucide-react':{TriangleAlertIcon:'span'},'../../lib/utils':{cn:(...classes)=>classes.filter(Boolean).join(' ')},
  '../ui/alert':{Alert:'section',AlertAction:'div',AlertDescription:'p',AlertTitle:'h2'},'../ui/button':{Button:'button'},
 });
 let clicks=0;const tree=module.TunnelLimitAlert({onManageTunnels:()=>clicks++});const elements=[];
 function visit(node){if(Array.isArray(node))return node.forEach(visit);if(node&&typeof node==='object'){elements.push(node);visit(node.props?.children);}}
 visit(tree);assert.equal(elements.filter(e=>e.type==='a').length,0);
 const button=elements.find(e=>e.type==='button');assert.equal(button.props.children,'Manage tunnels');button.props.onClick();assert.equal(clicks,1);
 const {renderToStaticMarkup}=createRequire(import.meta.url)('react-dom/server');
 const html=renderToStaticMarkup(tree);assert.match(html,/tunnel limit/);assert.doesNotMatch(html,/T3 Chat|t3\.chat|Upgrade|subscription/);
});
