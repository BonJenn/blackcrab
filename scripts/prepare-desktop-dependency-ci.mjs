// Authenticate a fresh upstream source before native dependency installation.
import fs from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {UPSTREAM} from '../managed-desktop/artifact.mjs';
import {prepareSource} from '../managed-desktop/source.mjs';
const {values}=parseArgs({options:{root:{type:'string'}}});
const output=process.env.GITHUB_OUTPUT;
if(!values.root||!path.isAbsolute(values.root)||!output||!path.isAbsolute(output))throw Error('Absolute new CI root and output required');
await fs.mkdir(values.root);const archive=path.join(values.root,'upstream.tar.gz');
const response=await fetch(`https://api.github.com/repos/${UPSTREAM.repository}/tarball/${UPSTREAM.commit}`,{signal:AbortSignal.timeout(180000)});
if(!response.ok||!response.body)throw Error('Pinned desktop source download failed');
const file=await fs.open(archive,'wx');let size=0;
try{for await(const bytes of response.body){size+=bytes.length;if(size>512*1024**2)throw Error('Source archive exceeds bound');await file.writeFile(bytes);}}finally{await file.close();}
const {source}=await prepareSource({archive,cacheDir:path.join(values.root,'source-cache')});
await fs.appendFile(output,`source=${source}\n`);
console.log(JSON.stringify({source,commit:UPSTREAM.commit,archiveSha256:UPSTREAM.archiveSha256,prepared:true}));
