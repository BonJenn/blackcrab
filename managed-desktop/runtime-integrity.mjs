import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';

const EFFECT_VERSION='4.1.2';
/** Codec ASTs are not interchangeable between separate physical Effect runtimes. */
export async function assertCanonicalEffect(source){
 const workspaces=['','scripts'];for(const top of ['apps','packages'])for(const entry of await fs.readdir(path.join(source,top)))workspaces.push(path.join(top,entry));
 const roots=new Set(),checked=[];
 async function record(file,label){const root=await fs.realpath(path.dirname(file)),pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));if(pkg.name!=='effect'||pkg.version!==EFFECT_VERSION)throw Error('Unexpected Effect runtime version');roots.add(root);checked.push(label);}
 for(const workspace of workspaces){const modules=path.join(source,workspace,'node_modules');try{await record(path.join(modules,'effect/package.json'),workspace||'root');}catch(error){if(!['ENOENT','ENOTDIR'].includes(error.code))throw error;}
  let effectPackages;try{effectPackages=await fs.readdir(path.join(modules,'@effect'));}catch(error){if(!['ENOENT','ENOTDIR'].includes(error.code))throw error;continue;}
  for(const name of effectPackages){const root=await fs.realpath(path.join(modules,'@effect',name)),metadata=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));if(!metadata.dependencies?.effect&&!metadata.peerDependencies?.effect)continue;const resolved=createRequire(path.join(root,'package.json')).resolve('effect/package.json');await record(resolved,path.join(workspace,'@effect',name));}
 }
 if(roots.size!==1)throw Error('Managed desktop requires ONE physical Effect runtime; resolved '+roots.size+' copies');
 return {root:[...roots][0],version:EFFECT_VERSION,checked};
}

export async function assertBundleEffectSingleton(directory,expectedRoot){
 const roots=new Set(),realRoots=new Map();let effectSources=0;
 async function visit(dir){for(const name of await fs.readdir(dir)){const file=path.join(dir,name),stat=await fs.lstat(file);if(stat.isDirectory())await visit(file);else if(name.endsWith('.map')){const map=JSON.parse(await fs.readFile(file,'utf8'));for(const source of map.sources??[]){const resolved=path.resolve(path.dirname(file),map.sourceRoot??'',source),marker=path.sep+'node_modules'+path.sep+'effect'+path.sep,index=resolved.lastIndexOf(marker);if(index<0)continue;const root=resolved.slice(0,index+marker.length-1);if(!realRoots.has(root))realRoots.set(root,await fs.realpath(root));roots.add(realRoots.get(root));effectSources++;}}}}
 await visit(directory);const canonical=await fs.realpath(expectedRoot);if(effectSources===0||roots.size!==1||!roots.has(canonical))throw Error('Managed desktop bundle contains missing, foreign or duplicate physical Effect runtimes');return {copies:1,sources:effectSources};
}
