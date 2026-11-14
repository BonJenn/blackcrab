import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {applySourcePatchRecords} from '../../managed-host/source.mjs';
/** Apply only to a disposable, authenticated producer source AFTER production desktop patches.
 * Not imported by production builders. Host upgrade/migration must be coordinated for 0.4.5.
 */
export async function applyIdeMode(source) {
 const base=fileURLToPath(new URL('.',import.meta.url));
 const records=JSON.parse(await fs.readFile(new URL('registry.json',import.meta.url),'utf8'));
 return applySourcePatchRecords(source,{records,patchDirectory:base});
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
 if(process.argv.length!==3)throw Error('Usage: node managed-desktop/ide-mode/apply.mjs /absolute/prepared-source');
 console.log(await applyIdeMode(process.argv[2]));
}
