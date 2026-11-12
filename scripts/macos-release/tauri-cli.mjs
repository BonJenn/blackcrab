import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// tauri-action appends `build`; preserve its updater/signing behavior while
// routing the build through Blackcrab's verified managed-resource wrapper.
const [command,...args]=process.argv.slice(2);
if(command!=='build')throw Error('Managed release CLI supports only tauri build');
const root=process.env.BLACKCRAB_RELEASE_PAYLOADS_DIR;
if(!root||!path.isAbsolute(root)||await fs.realpath(root)!==root)throw Error('Verified absolute release payload directory required');
const child=spawn(process.execPath,[fileURLToPath(new URL('../tauri-build.mjs',import.meta.url)),'--signed','--managed-desktop',path.join(root,'desktop'),'--managed-service-host',path.join(root,'service-host'),...args],{stdio:'inherit'});
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
child.once('error',()=>{console.error('Managed release build could not start');process.exitCode=1;});
child.once('exit',(code,signal)=>{process.exitCode=signal?1:code??1;});
