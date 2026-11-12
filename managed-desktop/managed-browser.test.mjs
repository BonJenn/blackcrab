import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import * as Stream from 'effect/Stream';
import * as Schema from 'effect/Schema';
import * as Context from 'effect/Context';
import * as Exit from 'effect/Exit';
import * as Cause from 'effect/Cause';
import * as contracts from '@t3tools/contracts';

const require=createRequire(import.meta.url),ts=require('typescript');
const BrowserHost=Context.Service('ManagedBrowserTest/BrowserHost');
const Dependency=Context.Service('ManagedBrowserTest/Dependency');
const bytes=value=>new TextEncoder().encode(JSON.stringify(value));
const event={type:'attached',threadId:'thread',tabId:'tab'};
const command={type:'turn',threadId:'thread',active:true};

function fixture(){
 const fibers=[];
 let options,stops=0;
 const record=fiber=>{fibers.push(fiber);return fiber;};
 const modules={
  'effect/Effect':{...Effect,runFork:effect=>record(Effect.runFork(effect)),runForkWith:context=>effect=>record(Effect.runForkWith(context)(effect))},
  'effect/Fiber':Fiber,'effect/Stream':Stream,'effect/Schema':Schema,
  '@t3tools/contracts':contracts,
  '@t3tools/shared/leasedDesktopBrowser':{connectBrowser:()=>{throw Error('No socket connection expected');}},
  '../preview/DesktopBrowserHost.ts':{DesktopBrowserHost:BrowserHost},
  './ManagedBootstrap.mjs':{descriptor:{browser:{path:'/fixture/socket',key:'fixture'},owner:{environmentId:'env',generation:1}}},
  './managed-desktop/descriptor.mjs':{inspectBrowserCapability:()=>{}},
  './managed-desktop/browser-peer.mjs':{createBrowserPeer:value=>{options=value;return {start(){},stop(){stops++;}};}},
 };
 const module={exports:{}};
 const source=fs.readFileSync(new URL('./runtime/ManagedBrowser.ts',import.meta.url),'utf8');
 const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(output,{module,exports:module.exports,TextDecoder,JSON,require:name=>{
  if(!Object.hasOwn(modules,name))throw Error('Unexpected bridge dependency '+name);
  return modules[name];
 }});
 return {fibers,get options(){return options;},get stops(){return stops;},run(browser,use){
  return Effect.runPromise(Effect.scoped(Effect.gen(function*(){
   yield* module.exports.make;
   yield* Effect.promise(()=>use(options));
  })).pipe(Effect.provideService(BrowserHost,browser),Effect.provideService(Dependency,'provided context')));
 }};
}

test('browser event and command callbacks retain the surrounding Effect services',async()=>{
 const f=fixture(),sent=[],handled=[];
 const browser={
  events:Stream.fromEffect(Effect.map(Dependency,value=>{assert.equal(value,'provided context');return bytes(event);})),
  handleCommandLine:(line,epoch,current)=>Effect.map(Dependency,value=>{handled.push({value,command:JSON.parse(line),epoch,current:current()});}),
 };
 await f.run(browser,async options=>{
  const unsubscribe=options.subscribe(async value=>{sent.push(value);return true;});
  const subscription=f.fibers[0];
  const work=options.dispatch(command,'epoch',()=>true);
  assert(Exit.isSuccess(await work.done));
  assert(Exit.isSuccess(await Effect.runPromise(Fiber.await(subscription))));
  assert.deepEqual(sent,[event]);
  assert.deepEqual(handled,[{value:'provided context',command,epoch:'epoch',current:true}]);
  unsubscribe();
 });
 assert.equal(f.stops,1);
});

test('malformed browser events fail through the schema without forwarding or throwing a defect',async()=>{
 for(const raw of ['{invalid JSON',JSON.stringify({type:'attached',threadId:'thread'})]){
  const f=fixture(),sent=[];
  await f.run({events:Stream.make(new TextEncoder().encode(raw)),handleCommandLine:()=>Effect.void},async options=>{
   const unsubscribe=options.subscribe(async value=>{sent.push(value);return true;});
   const exit=await Effect.runPromise(Fiber.await(f.fibers[0]));
   assert(Exit.isFailure(exit));assert(Cause.hasFails(exit.cause));assert(!Cause.hasDies(exit.cause));
   assert.deepEqual(sent,[]);unsubscribe();
  });
  assert.equal(f.stops,1);
 }
});

test('cancel interrupts only the captured browser command and retains services for cleanup',async()=>{
 const f=fixture(),started=Promise.withResolvers();let cleaned;
 const browser={events:Stream.empty,handleCommandLine:()=>Effect.gen(function*(){
  yield* Dependency;started.resolve();yield* Effect.never;
 }).pipe(Effect.ensuring(Effect.map(Dependency,value=>{cleaned=value;})))};
 await f.run(browser,async options=>{
  const work=options.dispatch(command,'epoch',()=>true);
  const began=await Promise.race([started.promise.then(()=>true),work.done.then(()=>false)]);
  assert.equal(began,true,'command must start with its required services');work.cancel();
  assert(Exit.isFailure(await work.done));assert.equal(cleaned,'provided context');
 });
 assert.equal(f.stops,1);
});
