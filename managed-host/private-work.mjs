import fs from 'node:fs/promises';import path from'node:path';import{controlledCommand}from'./controlled-process.mjs';import{execFile}from'node:child_process';import{promisify}from'node:util';
const exec=promisify(execFile);
export async function validatePrivateWorkDirectory(directory,control){
 const s=await fs.lstat(directory);if(!path.isAbsolute(directory)||await fs.realpath(directory)!==directory||!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid?.()||(s.mode&0o777)!==0o700)throw Error('Private work directory must be canonical owned0700');
 if(process.platform!=='darwin')throw Error('This private work controller requires macOS ownership-enabled APFS');
 const code="import os,sys,plistlib,subprocess; p=os.path.realpath(sys.argv[1]); dev=os.stat(p).st_dev; m=p\nwhile os.path.dirname(m)!=m and os.stat(os.path.dirname(m)).st_dev==dev: m=os.path.dirname(m)\nx=plistlib.loads(subprocess.check_output(['/usr/sbin/diskutil','info','-plist',m])); assert x.get('FilesystemType')=='apfs' and x.get('GlobalPermissionsEnabled') is True and os.path.realpath(x.get('MountPoint',''))==m and os.stat(m).st_dev==dev; print('owned-apfs')";
 const options={env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',PYTHONNOUSERSITE:'1'},maxBuffer:8192,label:'private-work-ownership-check'};
 const result=control?await controlledCommand('/usr/bin/python3',['-I','-c',code,directory],options,control):await exec('/usr/bin/python3',['-I','-c',code,directory],options);
 if(result.stdout.trim()!=='owned-apfs')throw Error('Private work ownership proof unavailable');return directory;
}
