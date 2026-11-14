import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {selectBuildTarget,buildEnvironment,prepareBuildEnvironment,pnpmCommand,runBuildStep} from './build-platform.mjs';

async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'blackcrab-build-platform-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
test('portable compile-only selection cannot cross-build, enable production or mix Mac QA',()=>{
 for(const [platform,arch] of [['win32','x64'],['linux','x64']]){
  assert.throws(()=>selectBuildTarget({platform,arch}),/not implemented/);
  const options={platform,arch,buildOnlyTarget:platform+'-'+arch};
  assert.equal(selectBuildTarget(options).producerImplemented,false);
  for(const variant of [{qa:true},{nativeKeychainQaNonce:'1234567890123456'},{platform:'darwin',arch:'arm64'}])assert.throws(()=>selectBuildTarget({...options,...variant}));
 }
 assert.equal(selectBuildTarget({platform:'darwin',arch:'arm64'}).id,'darwin-arm64');
});
test('Windows build environment uses isolated directories, correct delimiter and only OS essentials',()=>{
 const env=buildEnvironment({node:'C:\\tool chain\\node.exe',home:'D:\\scratch\\home',temporary:'D:\\scratch\\temp',platform:'win32',systemRoot:'C:\\Windows'});
 assert.equal(env.PATH,'C:\\tool chain;C:\\Windows\\System32;C:\\Windows');
 assert.equal(env.USERPROFILE,env.HOME);assert.equal(env.APPDATA,'D:\\scratch\\home\\roaming');
 assert.equal(env.npm_config_userconfig,'D:\\scratch\\home\\empty.npmrc');
 assert.equal(env.TEMP,env.TMPDIR);assert.equal(env.WINDIR,env.SystemRoot);
 assert(!Object.hasOwn(env,'GITHUB_TOKEN'));assert(!Object.hasOwn(env,'NODE_OPTIONS'));
 assert.throws(()=>buildEnvironment({node:'C:\\node.exe',home:'D:\\home',temporary:'D:\\temp',platform:'win32',systemRoot:'relative'}),/system directory/);
});
test('pnpm Node entry preserves argument boundaries and rejects Windows placeholder scripts',()=>{
 assert.deepEqual(pnpmCommand('C:\\node.exe','C:\\with spaces\\pnpm.mjs',['--store-dir','D:\\my store'],'win32'),{command:'C:\\node.exe',args:['C:\\with spaces\\pnpm.mjs','--store-dir','D:\\my store']});
 assert.throws(()=>pnpmCommand('C:\\node.exe','C:\\pnpm.cmd',[],'win32'),/explicit/);
 assert.deepEqual(pnpmCommand('/node','/bin/pnpm',['--version'],'darwin'),{command:'/bin/pnpm',args:['--version']});
});
test('captured steps use fresh npm config, preserve spaced arguments and report nonzero exits',async t=>{
 const root=await fixture(t),env=await prepareBuildEnvironment({node:process.execPath,home:path.join(root,'home'),temporary:path.join(root,'tmp')});
 assert.equal(await fs.readFile(env.npm_config_userconfig,'utf8'),'');
 await assert.rejects(prepareBuildEnvironment({node:process.execPath,home:env.HOME,temporary:env.TMPDIR}),{code:'EEXIST'});
 await runBuildStep({name:'ok',command:process.execPath,args:['-e','console.log(process.argv[1])','one path with spaces'],cwd:root,env,logs:root});
 assert.equal((await fs.readFile(path.join(root,'ok.log'),'utf8')).trim(),'one path with spaces');
 await assert.rejects(runBuildStep({name:'bad',command:process.execPath,args:['-e','process.exit(7)'],cwd:root,env,logs:root}),/bad failed/);
});
test('timed-out captured build step cannot report success',async t=>{
 const root=await fixture(t),env=await prepareBuildEnvironment({node:process.execPath,home:path.join(root,'home'),temporary:path.join(root,'tmp')});
 await assert.rejects(runBuildStep({name:'timeout',command:process.execPath,args:['-e','setInterval(()=>{},1000)'],cwd:root,env,logs:root,timeoutMs:100}),/timeout failed/);
});
