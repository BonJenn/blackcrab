import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { verifyActivation } from './activation/generator.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const RESOURCE_PATHS = Object.freeze([
 'device-stream/index.js','device-stream/package.json','preview-stream/index.js','preview-stream/package.json',
 'licenses/fast-base64-decode-1.0.0.txt','licenses/NOTICE-INPUTS.json',
 'third-party-licenses/index.js','third-party-licenses/package.json',
 ...['global.css','generated-uniwind-themes.css','generated-uniwind-theme-names.json','generated-uniwind-default-theme-variables.json','clerk-theme.json'].map(name=>'styles/'+name),
].map(name=>'apps/mobile/.generated/'+name));
export function validateResourceRecords(records) {
 const remaining=new Set(RESOURCE_PATHS);
 if(!Array.isArray(records)||records.length!==remaining.size)throw Error('Native resource inventory differs');
 for(const record of records) {
  if(!record||!remaining.delete(record.path)||!Number.isSafeInteger(record.bytes)||record.bytes<0||record.bytes>64*1024*1024||!/^[a-f0-9]{64}$/.test(record.sha256))throw Error('Native resource record is invalid');
 }
 return records;
}
async function regular(file) {
 const stat=await fs.lstat(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>64*1024*1024)throw Error('Native resource is not a regular bounded file');
 return fs.readFile(file);
}
/** Read-only verification of all original13 outputs and exact owned-source provenance. */
export async function verifyMobileResources(repoRoot) {
 const generated=path.join(repoRoot,'apps/mobile/.generated');
 const stat=await fs.lstat(generated);
 if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Native resource root is not a real directory');
 await verifyActivation({consumer:path.join(repoRoot,'vendor/t3-mobile'),output:path.join(generated,'native-ui')});
 const activationBytes=await regular(path.join(generated,'native-ui/ACTIVATION-MANIFEST.json'));
 const activation=JSON.parse(activationBytes);
 const manifest=JSON.parse(await regular(path.join(generated,'RESOURCE-MANIFEST.json')));
 if(manifest.schema!==1||manifest.source?.activationManifestSha256!==sha(activationBytes)||manifest.source?.consumerManifestSha256!==activation.consumerManifestSha256||manifest.source?.activationRegistrySha256!==activation.registrySha256)throw Error('Native resource source provenance differs');
 for(const record of validateResourceRecords(manifest.records)) {
  const bytes=await regular(path.join(repoRoot,record.path));
  if(bytes.length!==record.bytes||sha(bytes)!==record.sha256)throw Error('Native resource bytes differ: '+record.path);
 }
 return {records:manifest.records.length,sourceIntegrated:true,nativeValidationPending:true};
}
