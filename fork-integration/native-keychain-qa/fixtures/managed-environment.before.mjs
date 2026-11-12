import fs from 'node:fs';
import path from 'node:path';
import {NAMESPACE} from './descriptor.mjs';
// Same foreign configuration prefixes cleared by the existing ManagedBootstrap.
const foreignPrefix = /^(T3CODE_|VITE_|OTEL_)/;
const foreign = key => foreignPrefix.test(key) || key === 'GITHUB_APP_CLIENT_ID';
const owned = ['HOME','TMPDIR','T3CODE_HOME','T3CODE_DISABLE_AUTO_UPDATE','T3CODE_DESKTOP_APP_USER_MODEL_ID','OTEL_SDK_DISABLED'];
export function captureManagedShellAuthority(env) {
 const result = Object.fromEntries(owned.map(key=>[key,env[key]]));
 for(const key of ['HOME','TMPDIR','T3CODE_HOME']) if(typeof result[key]!=='string'||!path.isAbsolute(result[key])||result[key].includes('\0')) throw Error('Managed environment authority is unavailable');
 if(result.TMPDIR!==path.join(result.T3CODE_HOME,'tmp')||result.T3CODE_DISABLE_AUTO_UPDATE!=='true'||result.T3CODE_DESKTOP_APP_USER_MODEL_ID!==NAMESPACE.appId||result.OTEL_SDK_DISABLED!=='true') throw Error('Managed environment authority differs');
 return Object.freeze(result);
}
export function filterManagedShellEnvironment(authority,candidate) {
 const trusted = captureManagedShellAuthority(authority);
 return Object.assign(Object.fromEntries(Object.entries(candidate).filter(([key])=>!foreign(key)&&!owned.includes(key))),trusted);
}
export function restoreManagedShellAuthority(env,authority) {
 const trusted=captureManagedShellAuthority(authority);
 for(const key of Object.keys(env))if(foreign(key)||owned.includes(key))delete env[key];
 Object.assign(env,trusted);
}
function privateDirectory(root,target) {
 if(path.resolve(root)!==root||!target.startsWith(root+path.sep)||typeof process.getuid!=='function')throw Error('Managed storage path differs');
 const flags=fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW;
 if(typeof fs.constants.O_DIRECTORY!=='number'||typeof fs.constants.O_NOFOLLOW!=='number')throw Error('Managed directory verification is unavailable');
 const uid=BigInt(process.getuid());let current=root;
 const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
 const owned=stat=>stat.isDirectory()&&!stat.isSymbolicLink()&&stat.uid===uid;
 for(const part of ['.',...path.relative(root,target).split(path.sep)]) {
  let fd;
  try {
   if(part!=='.'){current=path.join(current,part);try{fs.mkdirSync(current,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}}
   fd=fs.openSync(current,flags);
   const opened=fs.fstatSync(fd,{bigint:true}),before=fs.lstatSync(current,{bigint:true});
   if(!owned(opened)||!owned(before)||!same(opened,before)||fs.realpathSync(current)!==current)throw Error('unsafe directory');
   // The descriptor root is an authority boundary, never silently repaired.
   if(part==='.'&&(opened.mode&0o7777n)!==0o700n)throw Error('unsafe root');
   // Older Node/Electron children may be0755 under022. Tighten only this owned inode.
   if(part!=='.'&&(opened.mode&0o7777n)!==0o700n)fs.fchmodSync(fd,0o700);
   const after=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(current,{bigint:true});
   if(!owned(after)||!owned(named)||!same(opened,after)||!same(after,named)||(after.mode&0o7777n)!==0o700n||(named.mode&0o7777n)!==0o700n||fs.realpathSync(current)!==current)throw Error('directory changed');
  } catch {throw Error('Managed storage directory is not private');}
  finally {if(fd!==undefined)fs.closeSync(fd);}
 }
}

export function configureManagedEnvironment(app,root,env) {
 for(const key of Object.keys(env))if(foreign(key))delete env[key];
 Object.assign(env,{T3CODE_HOME:root,T3CODE_DISABLE_AUTO_UPDATE:'true',T3CODE_DESKTOP_APP_USER_MODEL_ID:NAMESPACE.appId,OTEL_SDK_DISABLED:'true'});
 captureManagedShellAuthority(env);
 const appData=path.join(root,'app-data'),userData=path.join(appData,NAMESPACE.profile);
 const locations={appData,userData,sessionData:userData,temp:path.join(root,'tmp'),crashDumps:path.join(userData,'Crashpad')};
 for(const location of Object.values(locations))privateDirectory(root,location);
 privateDirectory(root,path.join(root,'logs'));
 app.name=NAMESPACE.name;
 for(const [key,location]of Object.entries(locations))app.setPath(key,location);
 app.setAppLogsPath(path.join(root,'logs'));
 return Object.freeze(locations);
}
