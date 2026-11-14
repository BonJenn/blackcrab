/** Relocatable node_modules without Windows junctions or symlink privileges. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {desktopTarget} from './targets.mjs';
import {packageRoot} from './package-resolution.mjs';

const external=name=>['@napi-rs/keyring','@crowecawcaw/xa11y','@clerk/electron-passkeys','electron-webauthn','ffi-rs','@yuuang/','playwright-core'].some(p=>name.startsWith(p));
export function requiredNativePackage(name,targetId){
 const suffix={'win32-x64':'win32-x64-msvc','linux-x64':'linux-x64-gnu'}[targetId];
 if(!suffix)return null;
 const prefix={'@napi-rs/keyring':'@napi-rs/keyring-','@crowecawcaw/xa11y':'@crowecawcaw/xa11y-','ffi-rs':'@yuuang/ffi-rs-','@clerk/electron-passkeys':targetId==='win32-x64'?'@clerk/electron-passkeys-':null}[name];
 return prefix?prefix+suffix:null;
}
function matches(values,value){if(values===undefined)return true;if(!Array.isArray(values)||!values.every(x=>typeof x==='string'))throw Error('Invalid native dependency platform metadata');return !values.includes('!'+value)&&(!values.some(x=>!x.startsWith('!'))||values.includes(value)||values.includes('any'));}

export async function stagePhysicalRuntimeDependencies(source,appRoot,{targetId}={}){
 const target=desktopTarget(targetId);
 const desktop=path.join(source,'apps/desktop'),metadata=JSON.parse(await fs.readFile(path.join(desktop,'package.json'),'utf8'));
 const root=path.join(appRoot,'node_modules');
 await fs.mkdir(root); // Refuse overwriting an existing closure.
 const packages=[],missingOptional=[],noticeRoots=new Set();
 let bytes=0,entries=0;
 async function copyPackage(input,output,base=input,seen=new Set()){
  const actual=await fs.realpath(input),relative=path.relative(base,actual);
  if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Dependency content link escapes its package');
  const stat=await fs.stat(actual);
  if(++entries>50000)throw Error('Dependency closure entry bound exceeded');
  if(stat.isDirectory()){
   if(seen.has(actual))throw Error('Cyclic dependency content link');
   const ancestry=new Set(seen).add(actual);await fs.mkdir(output,{recursive:true});
   for(const name of (await fs.readdir(actual)).sort()){
    if(actual===base&&name==='node_modules')continue;
    await copyPackage(path.join(actual,name),path.join(output,name),base,ancestry);
   }
  }else if(stat.isFile()){
   bytes+=stat.size;if(bytes>8*1024**3)throw Error('Dependency closure byte bound exceeded');
   await fs.copyFile(actual,output);if(process.platform!=='win32')await fs.chmod(output,stat.mode&0o777);
  }else throw Error('Unsupported dependency content entry');
 }
 async function install(name,from,destination,ancestors=[],optional=false){
  let pkg;
  try{pkg=await packageRoot(name,from);}catch(error){if(optional&&error.code==='BLACKCRAB_DEPENDENCY_ABSENT'){missingOptional.push({name,reason:'optional package absent'});return;}throw error;}
  if(!matches(pkg.value.os,target.electron.platform)||!matches(pkg.value.cpu,target.electron.arch)||!matches(pkg.value.libc,'glibc')){
   if(!optional)throw Error('Required dependency does not support '+targetId+': '+name);
   missingOptional.push({name,reason:'not for '+targetId});return;
  }
  // Node resolves the nearest ancestor's node_modules first; reusing an ancestor
  // is valid only when no nearer package of the same name shadows that instance.
  const nearest=ancestors.find(p=>p.name===name);
  if(nearest?.root===pkg.root)return;
  if(ancestors.length>=40)throw Error('Dependency graph cannot be materialized within its depth bound');
  await fs.mkdir(path.dirname(destination),{recursive:true});
  await copyPackage(pkg.root,destination);
  packages.push({name,version:pkg.value.version,path:path.relative(appRoot,destination).split(path.sep).join('/')});noticeRoots.add(pkg.root);
  const next=[{name,root:pkg.root},...ancestors],required=requiredNativePackage(name,targetId);
  const dependencies={...pkg.value.dependencies,...pkg.value.optionalDependencies};
  if(required&&!Object.hasOwn(dependencies,required))throw Error('Native dependency declaration missing for '+name+' on '+targetId);
  for(const dep of Object.keys(dependencies).sort()){
   await install(dep,pkg.root,path.join(destination,'node_modules',dep),next,Object.hasOwn(pkg.value.optionalDependencies??{},dep)&&dep!==required);
  }
 }
 for(const name of Object.keys(metadata.dependencies??{}).filter(external).sort())await install(name,desktop,path.join(root,name));
 return{packages,missingOptional,noticeRoots:[...noticeRoots],layout:'physical-node-modules',target:targetId,nativeValidation:'complete physical closure staged; native addon loading and workflow acceptance are separate'};
}
