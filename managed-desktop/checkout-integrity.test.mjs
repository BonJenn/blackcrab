import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {digest} from './artifact-data.mjs';

const exec=promisify(execFile);
test('Windows Git checkout preserves every pinned desktop source payload byte',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'blackcrab-checkout-integrity-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:3}));
 // A private repository/index prevents changes to the real checkout or Git config.
 const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(root,'empty-config')};
 for(const key of ['GIT_DIR','GIT_WORK_TREE','GIT_INDEX_FILE','GIT_COMMON_DIR','GIT_CONFIG_COUNT','GIT_CONFIG_PARAMETERS'])delete env[key];
 const git=async args=>(await exec('git',args,{cwd:root,env,encoding:'buffer',timeout:30_000,maxBuffer:8*1024**2})).stdout;
 await git(['init','--quiet']);
 const repository=fileURLToPath(new URL('../',import.meta.url));
 const records=JSON.parse(await fs.readFile(new URL('./patches/registry.json',import.meta.url),'utf8'));
 const files=new Map();
 for(const record of records){const source=fileURLToPath(new URL('./patches/'+record.file,import.meta.url));const relative=path.relative(repository,source).split(path.sep).join('/');assert(relative.startsWith('managed-desktop/'));files.set(relative,record.sha256);const destination=path.join(root,relative);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.copyFile(source,destination);}
 await fs.copyFile(new URL('./.gitattributes',import.meta.url),path.join(root,'managed-desktop/.gitattributes'));
 await git(['-c','core.autocrlf=false','add','--all']);
 for(const [file,expected] of files){
  const converted=await git(['-c','core.autocrlf=true','-c','core.eol=crlf','cat-file','--filters',':'+file]);
  assert.equal(digest(converted),expected,`Windows checkout changed ${file}`);
 }
});
