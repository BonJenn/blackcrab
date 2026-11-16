// Native CI candidate only. Build the normal launcher with both real Windows
// payloads into an NSIS installer and verify what it carries. No release, no
// updater artifacts, no code signing.
import fs from 'node:fs/promises';
import path from 'node:path';
import {parseArgs, promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {runBuildStep} from '../managed-desktop/build-platform.mjs';
import {verifyArtifact} from '../managed-desktop/artifact.mjs';
import {verifyServiceProfileArtifact} from '../managed-host/service-profile.mjs';
import {readBlackcrabVersion} from '../managed-desktop/release-version.mjs';

const exec=promisify(execFile),repository=fileURLToPath(new URL('../',import.meta.url));
const {values}=parseArgs({options:{root:{type:'string'},host:{type:'string'},desktop:{type:'string'},'sign-updates':{type:'boolean'}}});
// A release signs its updater artifacts with the updater key. Pull requests never see the key.
const signUpdates=values['sign-updates']===true;
if(signUpdates&&!process.env.TAURI_SIGNING_PRIVATE_KEY?.trim())throw Error('Signing updates requires the updater key');
if(process.platform!=='win32'||process.arch!=='x64'||process.env.GITHUB_ACTIONS!=='true')throw Error('Disposable native Windows x64 CI required');
if(!['root','host','desktop'].every(k=>values[k]&&path.isAbsolute(values[k])))throw Error('Absolute new output and input paths required');
await fs.mkdir(values.root);
const root=await fs.realpath(values.root),logs=path.join(root,'logs');await fs.mkdir(logs);
const report={passed:false,published:false,updaterSigned:false,authenticodeSigned:false,uiAcceptance:'pending',target:'win32-x64'};
// Windows' own tar first: GNU tar reads "C:" in a path as a remote host.
const system=path.join(process.env.SystemRoot,'System32');
const environment={...process.env,PATH:[system,process.env.PATH].join(path.delimiter),CI:'true',CARGO_BUILD_JOBS:'2',CARGO_PROFILE_RELEASE_DEBUG:'0'};
for(const key of Object.keys(environment))if(/^(BLACKCRAB_EMBEDDED_|BLACKCRAB_SERVICE_ISSUER_PATH$)/.test(key)||(!signUpdates&&/^TAURI_SIGNING_/.test(key)))delete environment[key];
async function digest(file){const hash=createHash('sha256');for await(const bytes of createReadStream(file))hash.update(bytes);return hash.digest('hex');}
async function step(name,command,args,cwd=repository){return runBuildStep({name,command,args,cwd,env:environment,logs,timeoutMs:90*60*1000});}
async function named(directory,name){
  const found=[];
  async function visit(dir){for(const item of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())await visit(file);else if(item.isFile()&&item.name.toLowerCase()===name.toLowerCase())found.push(file);}}
  await visit(directory);if(found.length!==1)throw Error('Expected exactly one '+name+', found '+found.length);return found[0];
}
try{
  report.version=await readBlackcrabVersion();
  const desktop=await verifyArtifact(values.desktop,{expectedTarget:'win32-x64'});
  const host=await verifyServiceProfileArtifact(values.host,{platform:'win32',arch:'x64'});
  report.manifests={desktop:await digest(path.join(values.desktop,'blackcrab-managed-desktop.json')),host:await digest(path.join(values.host,'blackcrab-managed-host.json'))};
  report.files={desktop:desktop.files.length,host:host.files.length};
  await step('tauri-installer',process.execPath,[path.join(repository,'scripts/tauri-build.mjs'),signUpdates?'--updates':'--local','--target','x86_64-pc-windows-msvc','--bundles','nsis','--managed-desktop',values.desktop,'--managed-service-host',values.host]);
  const release=path.join(repository,'src-tauri/target/x86_64-pc-windows-msvc/release');
  const compiled=path.join(release,'blackcrab.exe');
  report.compiledRootSha256=await digest(compiled);
  const bundle=path.join(release,'bundle/nsis');
  const installers=(await fs.readdir(bundle)).filter(name=>name.toLowerCase().endsWith('-setup.exe'));
  if(installers.length!==1)throw Error('Expected exactly one NSIS installer, found '+installers.length);
  const installer=path.join(bundle,installers[0]);
  if(!installers[0].includes(report.version))throw Error('Installer name lacks the product version');
  report.installer={file:installer,bytes:(await fs.stat(installer)).size,sha256:await digest(installer)};
  if(signUpdates){
    // The signature beside the installer is what the update manifest carries.
    if(!(await fs.readFile(installer+'.sig','utf8')).trim())throw Error('The installer has no updater signature');
    report.installer.signatureFile=installer+'.sig';report.updaterSigned=true;
  }

  // Install for the current user, silently, into a directory of this run.
  const installed=path.join(root,'installed');
  await step('install',installer,['/S','/D='+installed]);
  const launcher=await named(installed,'blackcrab.exe');
  report.installedRootSha256=await digest(launcher);
  // Tauri stamps the bundle type into the launcher it packages, so compare
  // sizes and record both digests instead of requiring identical bytes.
  if((await fs.stat(launcher)).size!==(await fs.stat(compiled)).size)throw Error('Installed launcher size differs from its build output');
  report.payloadHashes={};
  for(const [role,name] of [['desktop','managed-desktop-payload.tar.gz'],['host','managed-host-payload.tar.gz']]){
    const archive=await named(installed,name);
    report.payloadHashes[role]=await digest(archive);
    const unpack=path.join(root,'verify-'+role);await fs.mkdir(unpack);
    await step('verify-extract-'+role,path.join(system,'tar.exe'),['-xzf',archive,'-C',unpack]);
    if(await digest(path.join(unpack,`blackcrab-managed-${role}.json`))!==report.manifests[role])throw Error('Bundled manifest differs');
    if(role==='desktop')await verifyArtifact(unpack,{expectedTarget:'win32-x64'});else await verifyServiceProfileArtifact(unpack,{platform:'win32',arch:'x64'});
  }
  const listing=[];
  for(const item of await fs.readdir(installed,{recursive:true,withFileTypes:true}))if(item.isFile())listing.push(path.relative(installed,path.join(item.parentPath,item.name)));
  report.installedFiles=listing.sort();
  report.installed=installed;report.launcher=launcher;
  report.passed=true;
  if(process.env.GITHUB_ENV)await fs.appendFile(process.env.GITHUB_ENV,`BLACKCRAB_WINDOWS_PACKAGE_REPORT=${path.join(root,'result.json')}\n`);
}catch(error){report.error=error.message;process.exitCode=1;}
await fs.writeFile(path.join(root,'result.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report));
