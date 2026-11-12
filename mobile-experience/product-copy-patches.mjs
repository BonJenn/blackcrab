import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {applySourcePatchRecords} from '../managed-host/source.mjs';

const directory=fileURLToPath(new URL('./product-copy/',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const descriptor=({id,target,sha256,beforeSha256,afterSha256})=>({id,target,sha256,beforeSha256,afterSha256,kind:'owned-product-copy'});
export async function productCopyRecords(){return JSON.parse(await fs.readFile(path.join(directory,'registry.json'),'utf8'));}
export async function productCopyDescriptors(){return (await productCopyRecords()).map(descriptor);}

/** Reconstruct each reviewed change; do not trust a caller's claimed final hash alone. */
export async function productCopyPatchedBytes(before,supplied){
 const record=(await productCopyRecords()).find(item=>item.id===supplied.id);
 if(!record||JSON.stringify(supplied)!==JSON.stringify(descriptor(record)))throw Error('Unregistered product-copy patch');
 if(hash(before)!==record.beforeSha256||hash(await fs.readFile(path.join(directory,record.file)))!==record.sha256)throw Error('Product-copy patch input differs');
 let expected=before.toString('utf8');
 for(const {before:anchor,after:replacement}of record.replacements){
  if(!anchor||expected.split(anchor).length!==2)throw Error('Product-copy patch anchor differs');
  expected=expected.replace(anchor,()=>replacement);
 }
 const after=Buffer.from(expected);
 if(hash(after)!==record.afterSha256)throw Error('Product-copy patch result differs');
 return after;
}

export async function applyProductCopyPatches(root){
 const records=await productCopyRecords();
 const originals=await Promise.all(records.map(async record=>({path:record.target,bytes:await fs.readFile(path.join(root,record.target))})));
 await applySourcePatchRecords(root,{records,patchDirectory:directory});
 return {patches:records.map(descriptor),originals};
}
