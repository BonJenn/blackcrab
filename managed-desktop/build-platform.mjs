/** Native build mechanics; no app/service activation or release-target enablement. */
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import fs from 'node:fs/promises';
import {desktopTarget,desktopBuildTarget} from './targets.mjs';

export function selectBuildTarget({buildOnlyTarget,qa=false,nativeKeychainQaNonce,platform=process.platform,arch=process.arch}={}) {
  if(buildOnlyTarget===undefined)return desktopBuildTarget(platform,arch);
  const target=desktopTarget(buildOnlyTarget);
  if(!['win32-x64','linux-x64'].includes(target.id)||target.id!==`${platform}-${arch}`)
    throw Error('Build-only target must match this Windows/Linux native runner');
  if(qa||nativeKeychainQaNonce!==undefined)throw Error('Mac QA modes cannot be used for a portable build');
  return target;
}

export function buildEnvironment({node,home,temporary,platform=process.platform,systemRoot=process.env.SystemRoot}) {
  const p=platform==='win32'?path.win32:path.posix;
  if(![node,home,temporary].every(value=>typeof value==='string'&&p.isAbsolute(value)))throw Error('Absolute build environment paths required');
  const env={HOME:home,TMPDIR:temporary,TEMP:temporary,TMP:temporary,CI:'1',COREPACK_ENABLE_PROJECT_SPEC:'0',npm_config_userconfig:p.join(home,'empty.npmrc'),npm_config_globalconfig:p.join(home,'empty-global.npmrc')};
  if(platform==='win32') {
    if(typeof systemRoot!=='string'||!p.isAbsolute(systemRoot))throw Error('Windows system directory unavailable');
    Object.assign(env,{SystemRoot:systemRoot,WINDIR:systemRoot,USERPROFILE:home,APPDATA:p.join(home,'roaming'),LOCALAPPDATA:p.join(home,'local'),PATH:[p.dirname(node),p.join(systemRoot,'System32'),systemRoot].join(';')});
  } else env.PATH=[p.dirname(node),'/usr/bin','/bin','/usr/sbin','/sbin'].join(':');
  return env;
}
export async function prepareBuildEnvironment(options) {
  const env=buildEnvironment(options);
  for(const dir of [env.HOME,env.TMPDIR,env.APPDATA,env.LOCALAPPDATA].filter(Boolean))await fs.mkdir(dir,{recursive:true,mode:0o700});
  for(const file of [env.npm_config_userconfig,env.npm_config_globalconfig])await fs.writeFile(file,'',{flag:'wx',mode:0o600});
  return env;
}
/** pnpm 12's ignored install scripts leave an extensionless Windows placeholder. */
export function pnpmCommand(node,pnpm,args=[],platform=process.platform) {
  if(/\.(?:mjs|cjs|js)$/i.test(pnpm))return {command:node,args:[pnpm,...args]};
  if(platform==='win32')throw Error('Windows requires the explicit pinned pnpm bin/pnpm.mjs entry');
  return {command:pnpm,args};
}

export async function runBuildStep({name,command,args,cwd,env,logs,timeoutMs=30*60*1000}) {
  const file=path.join(logs,name+'.log'),log=await fs.open(file,'wx',0o600);
  let child,timer,forceTimer,interrupted=false;
  const stop=()=>{
    if(interrupted)return;
    interrupted=true;
    if(!child?.pid||child.exitCode!==null||child.signalCode!==null)return;
    if(process.platform==='win32') {
      // Only the still-captured build child and its descendants; never discover/adopt a PID.
      execFile(path.join(env.SystemRoot,'System32','taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true,timeout:10_000},()=>{if(child.exitCode===null)child.kill();});
    } else {
      try{process.kill(-child.pid,'SIGTERM');}catch{}
      forceTimer=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)try{process.kill(-child.pid,'SIGKILL');}catch{}},5000);
    }
  };
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
  try {
    await new Promise((resolve,reject)=>{
      child=spawn(command,args,{cwd,env,detached:process.platform!=='win32',windowsHide:true,stdio:['ignore',log.fd,log.fd]});
      child.once('error',reject);
      child.once('close',code=>code===0&&!interrupted?resolve():reject(Error(name+' failed; see '+file)));
      timer=setTimeout(stop,timeoutMs);
    });
  } finally {clearTimeout(timer);clearTimeout(forceTimer);process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);await log.close();}
}
