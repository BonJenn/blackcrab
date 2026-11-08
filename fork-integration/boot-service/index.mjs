import fs from 'node:fs';
import {createHash} from 'node:crypto';
const registry=JSON.parse(fs.readFileSync(new URL('./registry.json',import.meta.url)));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const descriptors=()=>structuredClone(registry.patches);
export function applyBootServicePatch(bytes,id) {
 const patch=registry.patches.find(x=>x.id===id);if(!patch)throw Error('Unknown boot-service patch');
 if(hash(fs.readFileSync(new URL(patch.file,import.meta.url)))!==patch.sha256)throw Error('Boot-service diff changed');
 if(hash(bytes)!==patch.beforeSha256)throw Error('Boot-service source differs');
 let text=Buffer.from(bytes).toString('utf8');
 for(const {before,after}of patch.replacements){if(text.split(before).length!==2)throw Error('Boot-service replacement differs');text=text.replace(before,()=>after);}
 if(hash(text)!==patch.afterSha256)throw Error('Boot-service result differs');return Buffer.from(text);
}
