// Development helper: refresh payload hashes from reviewed source files, then sync generated QA
// source. Existing-file patches are recorded separately against the untouched producer baseline.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const url=new URL('./registry.json',import.meta.url),records=JSON.parse(await fs.readFile(url,'utf8'));
for(const record of records)if(record.kind==='payload'){
 const bytes=await fs.readFile(new URL(record.file,import.meta.url));
 record.sha256=record.afterSha256=createHash('sha256').update(bytes).digest('hex');
 if(process.argv[2])await fs.writeFile(path.join(process.argv[2],record.target),bytes);
}
await fs.writeFile(url,JSON.stringify(records,null,2)+'\n');
