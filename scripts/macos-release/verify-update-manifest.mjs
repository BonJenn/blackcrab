import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export function validateArm64Updater(value,{tag,signature}) {
  const keys=Object.keys(value?.platforms??{}).sort();
  if(value?.version!==tag?.slice(1)||!/^v\d+\.\d+\.\d+$/.test(tag??'')||
      JSON.stringify(keys)!==JSON.stringify(['darwin-aarch64','darwin-aarch64-app'])) {
    throw Error('Managed Mac release must advertise only its current Apple-silicon updater');
  }
  if(typeof signature!=='string'||!signature.trim())throw Error('Updater signature is missing');
  const primary=value.platforms['darwin-aarch64'];
  for(const entry of Object.values(value.platforms)) {
    const url=new URL(entry.url);
    if(url.origin!=='https://github.com'||url.search||url.hash||url.username||url.password||
       !url.pathname.startsWith(`/BonJenn/blackcrab/releases/download/${tag}/`)||
       !/^Blackcrab[^/]*_aarch64\.app\.tar\.gz$/.test(url.pathname.split('/').pop())||
       entry.signature?.trim()!==signature.trim()||entry.url!==primary.url)throw Error('Updater points to the wrong release, architecture or signature');
  }
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const [manifest,signature,tag]=process.argv.slice(2);
 validateArm64Updater(JSON.parse(await fs.readFile(manifest,'utf8')),{signature:await fs.readFile(signature,'utf8'),tag});
 console.log('Apple-silicon updater manifest matches the generated signature and release');
}
