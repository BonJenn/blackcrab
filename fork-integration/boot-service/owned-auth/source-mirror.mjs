// Developer staging only, never native authority. Every write is copy-on-write.
import fs from 'node:fs/promises';
import path from 'node:path';
export async function sourceMirror(root, sourceRoot) {
 root=path.resolve(root);sourceRoot=await fs.realpath(sourceRoot);
 if(root===sourceRoot||root.startsWith(sourceRoot+path.sep)||sourceRoot.startsWith(root+path.sep))throw Error('Source and mirror must be disjoint');
 const rootStat=await fs.lstat(root);
 if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||rootStat.uid!==process.getuid?.()||(rootStat.mode&0o777)!==0o700||await fs.realpath(root)!==root)throw Error('Mirror root must be canonical owned directory');
 function relative(value){if(typeof value!=='string'||!value||value.includes('\\')||value.includes('\0')||path.isAbsolute(value)||value.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Invalid mirror relative path');return value;}
 async function maybe(file){try{return await fs.lstat(file)}catch(error){if(error.code==='ENOENT')return undefined;throw error;}}
 async function originalDirectory(rel){let current=sourceRoot;for(const part of rel.split('/').filter(Boolean)){current=path.join(current,part);const s=await maybe(current);if(s===undefined)return undefined;if(!s.isDirectory()||s.isSymbolicLink())throw Error('Original directory cannot traverse symlink');}return current;}
 async function directory(rel){
  if(!rel)return;
  relative(rel);
  // Parent FIRST. lstat(child) alone follows any symlink in intermediate parents.
  const parent=path.posix.dirname(rel);await directory(parent==='.'?'':parent);
  const target=path.join(root,rel);const stat=await maybe(target);
  if(stat?.isDirectory()&&!stat.isSymbolicLink())return;
  if(stat&&!stat.isSymbolicLink())throw Error('Mirror directory collides with file');
  if(stat)await fs.unlink(target);
  await fs.mkdir(target,{mode:0o700});
  const original=await originalDirectory(rel);
  if(original)for(const name of await fs.readdir(original))await fs.symlink(path.join(original,name),path.join(target,name));
 }
 async function stage(rel,bytes){relative(rel);const parent=path.posix.dirname(rel);await directory(parent==='.'?'':parent);const target=path.join(root,rel),stat=await maybe(target);if(stat?.isDirectory()&&!stat.isSymbolicLink())throw Error('Mirror file collides with directory');if(stat)await fs.unlink(target);await fs.writeFile(target,bytes,{flag:'wx',mode:0o600});}
 return {directory,stage};
}
