import fs from'node:fs/promises';import path from'node:path';import{createReadStream,constants}from'node:fs';import{createHash}from'node:crypto';
export async function fileHash(file,control){const h=createHash('sha256');for await(const b of createReadStream(file)){control?.assertRunning();h.update(b);}return h.digest('hex');}
async function* entries(root,rel='',allowLinks=false,exclude=()=>false){
 for(const name of(await fs.readdir(path.join(root,rel))).sort()){
  const next=rel?rel+'/'+name:name;if(exclude(next))continue;
  const file=path.join(root,next),stat=await fs.lstat(file);
  if((stat.isSymbolicLink()&&!allowLinks)||(!stat.isSymbolicLink()&&!stat.isDirectory()&&!stat.isFile()))throw Error('Protected cache contains a link/nonregular entry');
  yield {rel:next,file,stat};
  if(stat.isDirectory())yield* entries(root,next,allowLinks,exclude);
 }
}
/** Bound open files and memory; retain deterministic output and settle every started operation on failure. */
async function orderedBatches(iterator,prepare,consume){
 const pending=[];
 const settle=async()=>{const result=await pending.shift();if(result.error)throw result.error;await consume(result.value);};
 try{
  for await(const entry of iterator){
   pending.push(Promise.resolve().then(()=>prepare(entry)).then(value=>({value}),error=>({error})));
   if(pending.length===16)await settle();
  }
  while(pending.length)await settle();
 }finally{await Promise.all(pending);}
}
/** Read-only protected input inventory; append order is deterministic, atime ignored. */
export async function inventory(root,output,control){
 const h=createHash('sha256');let files=0,bytes=0;const handle=await fs.open(output,'wx',0o600);
 try{
  await orderedBatches(entries(root,'',true),async({rel,file,stat:s})=>{
   control.assertRunning();
   return {path:rel,type:s.isSymbolicLink()?'symlink':s.isDirectory()?'directory':'file',mode:s.mode&0o777,uid:s.uid,gid:s.gid,dev:s.dev,ino:s.ino,nlink:s.nlink,size:s.isFile()?s.size:0,...(s.isFile()?{sha256:await fileHash(file,control)}:s.isSymbolicLink()?{link:await fs.readlink(file)}:{})};
  },async r=>{control.assertRunning();const line=JSON.stringify(r)+'\n';h.update(line);await handle.writeFile(line);if(r.type==='file'){files++;bytes+=r.size;}});
 }finally{await handle.close();}
 return {sha256:h.digest('hex'),files,bytes,manifest:output};
}
/** No hardlinks/symlinks/clones to protected data: each destination is a new inode. */
export async function copyPublicStore(source,destination,proofFile,control){
 await fs.mkdir(destination,{mode:0o700});const proof=await fs.open(proofFile,'wx',0o600);let files=0,bytes=0;
 async function* copyEntries(){
  for await(const entry of entries(source,'',false,rel=>rel==='v11/projects'||rel==='v11/links')){
   control.assertRunning();
   if(entry.stat.isDirectory())await fs.mkdir(path.join(destination,entry.rel),{mode:0o700});
   else yield entry;
  }
 }
 try{
  await orderedBatches(copyEntries(),async({rel,file,stat:s})=>{
   control.assertRunning();const dest=path.join(destination,rel),before=await fileHash(file,control);
   control.assertRunning();await fs.copyFile(file,dest,constants.COPYFILE_EXCL);const d=await fs.lstat(dest);
   if(!d.isFile()||d.isSymbolicLink()||d.nlink!==1||(d.dev===s.dev&&d.ino===s.ino)||await fileHash(dest,control)!==before||await fileHash(file,control)!==before)throw Error('Protected cache copy is not independent and identical');
   return {record:{path:rel,sha256:before,source:{dev:s.dev,ino:s.ino},destination:{dev:d.dev,ino:d.ino,nlink:d.nlink}},size:s.size};
  },async({record,size})=>{control.assertRunning();await proof.writeFile(JSON.stringify(record)+'\n');files++;bytes+=size;});
 }finally{await proof.close();}
 return {files,bytes,proofFile};
}
const cratePath=name=>name.length===1?'1/'+name:name.length===2?'2/'+name:name.length===3?'3/'+name[0]+'/'+name:name.slice(0,2)+'/'+name.slice(2,4)+'/'+name;
export function cargoPackages(lock){const result=[];for(const block of lock.split('[[package]]').slice(1)){const name=block.match(/^name = "([a-zA-Z0-9_-]+)"/m)?.[1],version=block.match(/^version = "([0-9A-Za-z.+_-]+)"/m)?.[1],source=block.match(/^source = "([^"]+)"/m)?.[1],checksum=block.match(/^checksum = "([a-f0-9]{64})"/m)?.[1];if(source){if(source!=='registry+https://github.com/rust-lang/crates.io-index'||!name||!version||!checksum)throw Error('Unknown monitor Cargo source');result.push({name,version,checksum,indexPath:cratePath(name)});}}if(result.length!==36)throw Error('Monitor Cargo closure changed');return result;}
export async function cargoSeedPlan(registry,packages,control){const result=[];for(const p of packages){const matches=[];for(const shard of(await fs.readdir(path.join(registry,'cache'))).sort().filter(x=>/^index\.crates\.io-[a-f0-9]+$/.test(x))){const archive=path.join(registry,'cache',shard,`${p.name}-${p.version}.crate`),index=path.join(registry,'index',shard,'.cache',p.indexPath),config=path.join(registry,'index',shard,'config.json');try{const s=await fs.lstat(archive);if(!s.isFile()||s.isSymbolicLink()||await fileHash(archive,control)!==p.checksum)continue;const metadata=JSON.parse(await fs.readFile(config));if(metadata.dl!=='https://static.crates.io/crates'||metadata.api!=='https://crates.io'||metadata['auth-required']===true||Object.keys(metadata).some(k=>!['dl','api','auth-required'].includes(k)))throw Error('Cargo public index metadata differs');const i=await fs.lstat(index);if(!i.isFile()||i.isSymbolicLink())continue;matches.push({...p,shard,archive,index,config,indexSha256:await fileHash(index,control),configSha256:await fileHash(config,control)});}catch(e){if(e.code!=='ENOENT')throw e;}}if(!matches.length)throw Error('Public offline Cargo cache incomplete: '+p.name);result.push(matches[0]);}return result;}
export async function copyCargoSeed(plan,home,control){const copied=new Map();for(const p of plan)for(const [source,relative,expected]of[[p.archive,`registry/cache/${p.shard}/${p.name}-${p.version}.crate`,p.checksum],[p.index,`registry/index/${p.shard}/.cache/${p.indexPath}`,p.indexSha256],[p.config,`registry/index/${p.shard}/config.json`,p.configSha256]]){if(copied.has(relative))continue;control.assertRunning();if(await fileHash(source,control)!==expected)throw Error('Cargo protected input changed');const dest=path.join(home,relative);await fs.mkdir(path.dirname(dest),{recursive:true,mode:0o700});await fs.copyFile(source,dest,constants.COPYFILE_EXCL);const a=await fs.lstat(source),b=await fs.lstat(dest);if(b.nlink!==1||(a.dev===b.dev&&a.ino===b.ino)||await fileHash(dest,control)!==expected)throw Error('Cargo copy aliases protected cache');copied.set(relative,expected);}return {files:copied.size,sourcePackages:plan.length};}

export function controllerMemoryUsage(){const{rss,heapUsed,external,arrayBuffers}=process.memoryUsage();return{rss,heapUsed,external,arrayBuffers};}
