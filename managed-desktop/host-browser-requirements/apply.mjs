import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {applySourcePatchRecords} from '../../managed-host/source.mjs';
import {fileDigest,relativePath,UPSTREAM} from '../artifact.mjs';
/** Apply only to an owned authenticated host source AFTER the recorded proof9 base. */
export async function applyHostBrowserRequirements(directory){
 const root=await fs.realpath(directory),base=new URL('./',import.meta.url),requirements=JSON.parse(await fs.readFile(new URL('base.json',base),'utf8')),registry=JSON.parse(await fs.readFile(new URL('registry.json',base),'utf8'));
 if(requirements.upstreamCommit!==UPSTREAM.commit)throw Error('Host browser source pin differs');
 for(const prerequisite of requirements.preconditions)if(await fileDigest(path.join(root,relativePath(prerequisite.target)))!==prerequisite.sha256)throw Error('Host browser requires exact proof9/own-origin base');
 return applySourcePatchRecords(root,{records:registry,patchDirectory:fileURLToPath(base)});
}
