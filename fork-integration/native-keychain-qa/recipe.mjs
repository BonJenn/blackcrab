/** Source-only, in-memory QA identity transform. No producer/launch/keychain entrypoint. */
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const registry=JSON.parse(await fs.readFile(new URL('./registry.json',import.meta.url),'utf8'));
export const QA_KIND='blackcrab-managed-desktop-native-keychain-qa';
export const sha256=value=>createHash('sha256').update(value).digest('hex');
const ENV='apps/desktop/src/app/DesktopEnvironment.ts';
const DESCRIPTOR='apps/desktop/src/app/managed-desktop/descriptor.mjs';
const BOOT='apps/desktop/src/app/ManagedBootstrap.mjs';
const MANAGED_ENV='apps/desktop/src/app/managed-desktop/environment.mjs';
const IDENTITY='apps/desktop/src/app/DesktopAppIdentity.ts';
const SAFE='apps/desktop/src/electron/ElectronSafeStorage.ts';
const MAIN='apps/desktop/src/main.ts';
const PKG='Blackcrab.app/Contents/Resources/app/package.json';
const PLIST='Blackcrab.app/Contents/Info.plist';
const fail=message=>{throw Error('Native keychain QA recipe: '+message);};
function exactKeys(value,keys){return value&&typeof value==='object'&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');}
function once(text,before,after){if(text.split(before).length!==2)fail('identity replacement must match once');return text.replace(before,()=>after);}
async function pinnedFixture(file,expected){const b=await fs.readFile(new URL('./'+file,import.meta.url));if(sha256(b)!==expected)fail('fixture pin differs: '+file);return b;}
export async function loadPinnedInputs(){return new Map(await Promise.all(registry.targets.map(async r=>[r.target,await pinnedFixture(r.fixture,r.beforeSha256)])));}
function stageBlock(environment){const start=environment.indexOf('function resolveDesktopAppStageLabel('),end=environment.indexOf('export function resolveDesktopAppBranding(',start);if(start<0||end<start)fail('original stage resolver absent');return environment.slice(start,end);}
/** Execute the actual pinned original pure predicate/resolver, without importing Electron/Effect. */
export async function resolvePinnedStage({isDevelopment,appVersion}){
 if(typeof isDevelopment!=='boolean'||typeof appVersion!=='string'||appVersion.length<1||appVersion.length>128)fail('stage input');
 const envRecord=registry.targets.find(r=>r.target===ENV);
 const env=(await pinnedFixture(envRecord.fixture,envRecord.beforeSha256)).toString();
 const predicate=(await pinnedFixture(registry.stagePredicate.fixture,registry.stagePredicate.sha256)).toString();
 const code=stripTypeScriptTypes(predicate.replace('export function','function')+'\n'+stageBlock(env)+'\nglobalThis.resolveStage=resolveDesktopAppStageLabel;',{mode:'strip'});
 const context=vm.createContext({input:Object.freeze({isDevelopment,appVersion})},{codeGeneration:{strings:false,wasm:false}});
 new vm.Script(code).runInContext(context,{timeout:100});
 return new vm.Script('resolveStage(input)').runInContext(context,{timeout:100});
}
function plistValue(text,key){const matches=[...text.matchAll(new RegExp('<key>'+key+'</key>\\s*<string>([^<]*)</string>','g'))];if(matches.length!==1)fail('plist key differs: '+key);return matches[0][1];}
function replacePlist(text,key,value){const before=plistValue(text,key);return once(text,'<key>'+key+'</key>'+text.match(new RegExp('<key>'+key+'</key>(\\s*)<string>'))[1]+'<string>'+before+'</string>','<key>'+key+'</key>'+text.match(new RegExp('<key>'+key+'</key>(\\s*)<string>'))[1]+'<string>'+value+'</string>');}
export async function prepareIdentity(options){
 if(!exactKeys(options,Object.hasOwn(options??{},'inputs')?['nonce','inputs']:['nonce'])||typeof options.nonce!=='string'||!/^[a-f0-9]{16}$/.test(options.nonce))fail('fixed16lowercasehex nonce required; no policy overrides');
 const inputs=options.inputs??await loadPinnedInputs();
 if(!(inputs instanceof Map)||inputs.size!==registry.targets.length)fail('complete exact input set required');
 for(const r of registry.targets){const b=inputs.get(r.target);if(!Buffer.isBuffer(b)||sha256(b)!==r.beforeSha256)fail('production predecessor differs: '+r.target);}
 const pkg=JSON.parse(inputs.get(PKG).toString());
 if(pkg.blackcrabManagedClient!=='production'||Object.hasOwn(pkg,'qaPolicy')||Object.hasOwn(pkg,'blackcrabNativeKeychainQa'))fail('production package predecessor required');
 const stage=await resolvePinnedStage({isDevelopment:false,appVersion:pkg.version});
 const baseName='Blackcrab Native QA '+options.nonce,appName=baseName+' '+stage;
 const namespace=Object.freeze({appId:'com.blackcrab.desktop.managed.nativekeychainqa.n'+options.nonce,name:appName,scheme:'blackcrab',profile:'blackcrab-managed-v1'});
 const identity=Object.freeze({nonce:options.nonce,appVersion:pkg.version,stage,baseName,appName,service:appName+' Safe Storage',account:appName,namespace});
 const files=new Map([...inputs].map(([p,b])=>[p,Buffer.from(b)]));
 const environment=inputs.get(ENV).toString();
 const environmentAfter=once(environment,'const APP_BASE_NAME = "Blackcrab";','const APP_BASE_NAME = '+JSON.stringify(baseName)+';');
 if(stageBlock(environment)!==stageBlock(environmentAfter))fail('original stage resolver changed');
 files.set(ENV,Buffer.from(environmentAfter));
 const descriptor=inputs.get(DESCRIPTOR).toString();
 const oldNamespace="export const NAMESPACE = Object.freeze({ appId: 'com.blackcrab.desktop.managed', name: 'Blackcrab', scheme: 'blackcrab', profile: 'blackcrab-managed-v1' });";
 files.set(DESCRIPTOR,Buffer.from(once(descriptor,oldNamespace,'export const NAMESPACE = Object.freeze('+JSON.stringify(namespace)+');')));
 // Bootstrap remains byte-identical: its existing NAMESPACE.name now resolves to the QA name.
 if(!files.get(BOOT).toString().includes('configureManagedEnvironment(Electron.app,root,process.env);')||!files.get(MANAGED_ENV).toString().includes('app.name=NAMESPACE.name;'))fail('original bootstrap environment/name binding absent');
 if(!files.get(IDENTITY).toString().includes('`${environment.branding.baseName} ${environment.branding.stageLabel}`'))fail('original identity configure differs');
 if(!files.get(MAIN).toString().includes('ElectronSafeStorage.layer,')||files.get(MAIN).toString().includes('ManagedQA'))fail('real production safeStorage graph required');
 for(const text of [files.get(SAFE),files.get(MAIN)].map(b=>b.toString()))if(text.includes('use-mock-keychain')||text.includes('setUsePlainTextEncryption'))fail('storage policy alteration refused');
 files.set(PKG,Buffer.from(JSON.stringify({...pkg,productName:appName,blackcrabManagedClient:'native-keychain-qa'},null,2)+'\n'));
 let plist=inputs.get(PLIST).toString();
 if(plistValue(plist,'CFBundleIdentifier')!=='com.blackcrab.desktop.managed'||plistValue(plist,'CFBundleName')!=='Blackcrab'||plistValue(plist,'CFBundleDisplayName')!=='Blackcrab')fail('production plist identity differs');
 for(const [key,value]of [['CFBundleIdentifier',namespace.appId],['CFBundleName',appName],['CFBundleDisplayName',appName]])plist=replacePlist(plist,key,value);
 files.set(PLIST,Buffer.from(plist));
 const records=registry.targets.map(r=>Object.freeze({target:r.target,phase:r.phase,beforeSha256:r.beforeSha256,afterSha256:sha256(files.get(r.target)),changed:sha256(files.get(r.target))!==r.beforeSha256}));
 const manifestIdentity=Object.freeze({format:1,kind:QA_KIND,namespace,upstream:registry.upstream,nativeKeychainQaIdentity:{version:1,nonce:options.nonce,appVersion:pkg.version,appName,service:identity.service,account:identity.account,nonAdoptable:true,records}});
 return Object.freeze({identity,files,records,manifestIdentity,buildOrLaunchAuthorized:false});
}
/** Strong preflight: compare every output byte to deterministic identity-only transformation. */
export async function assertIdentityConsistency(prepared){
 if(!prepared?.identity?.nonce)fail('prepared identity required');
 const expected=await prepareIdentity({nonce:prepared.identity.nonce});
 if(JSON.stringify(prepared.identity)!==JSON.stringify(expected.identity)||JSON.stringify(prepared.manifestIdentity)!==JSON.stringify(expected.manifestIdentity)||JSON.stringify(prepared.records)!==JSON.stringify(expected.records))fail('identity/namespace/provenance inconsistency');
 if(!(prepared.files instanceof Map)||prepared.files.size!==expected.files.size)fail('exact output set required');
 for(const [p,b]of expected.files)if(!Buffer.isBuffer(prepared.files.get(p))||!prepared.files.get(p).equals(b))fail('output identity or original logic changed: '+p);
 return Object.freeze({kind:QA_KIND,namespace:expected.identity.namespace,keychainService:expected.identity.service,keychainAccount:expected.identity.account,storageLogicUnchanged:true,nonAdoptable:true});
}
export function assertProductionRegistry(bytes){if(!Buffer.isBuffer(bytes)||sha256(bytes)!==registry.productionDesktopRegistrySha256)fail('reviewed complete production source graph changed');return true;}
