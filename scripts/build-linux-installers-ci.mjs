// Native CI candidate only. Build the normal launcher with both real payloads;
// verify the resulting deb/AppImage without publishing a release or updater.
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
const {values}=parseArgs({options:{root:{type:'string'},host:{type:'string'},desktop:{type:'string'}}});
if(process.platform!=='linux'||process.arch!=='x64'||process.env.GITHUB_ACTIONS!=='true')throw Error('Disposable native Linux x64 CI required');
if(!['root','host','desktop'].every(k=>values[k]&&path.isAbsolute(values[k])))throw Error('Absolute new output and input paths required');
await fs.mkdir(values.root,{mode:0o700});
const root=await fs.realpath(values.root),logs=path.join(root,'logs');await fs.mkdir(logs,{mode:0o700});
const report={passed:false,published:false,updaterSigned:false,uiAcceptance:'pending',target:'linux-x64',packages:[]};
const environment=Object.fromEntries(['PATH','HOME','LANG','LC_ALL','CARGO_HOME','RUSTUP_HOME'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
Object.assign(environment,{CI:'true',CARGO_BUILD_JOBS:'2',CARGO_PROFILE_RELEASE_DEBUG:'0',APPIMAGE_EXTRACT_AND_RUN:'1'});
async function digest(file){const hash=createHash('sha256');for await(const bytes of createReadStream(file))hash.update(bytes);return hash.digest('hex');}
async function step(name,command,args,cwd=repository){return runBuildStep({name,command,args,cwd,env:environment,logs,timeoutMs:60*60*1000});}
async function one(directory,suffix){const files=(await fs.readdir(directory)).filter(n=>n.endsWith(suffix));if(files.length!==1)throw Error('Expected exactly one '+suffix+' installer');return path.join(directory,files[0]);}
async function named(directory,name){
  const found=[];
  async function visit(dir){for(const item of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())await visit(file);else if(item.isFile()&&item.name===name)found.push(file);}}
  await visit(directory);if(found.length!==1)throw Error('Installer does not contain exactly one '+name);return found[0];
}
// Returns the stamps when two launchers differ only inside Tauri's bundle-type
// marker suffix; any other difference (or a missing/wrong stamp) is rejected.
async function bundleStampOnly(packagedFile,compiledFile){
  const [packaged,compiled]=await Promise.all([fs.readFile(packagedFile),fs.readFile(compiledFile)]);
  if(packaged.length!==compiled.length)throw Error('Packaged Debian launcher size differs from its build output');
  const marker=Buffer.from('__TAURI_BUNDLE_TYPE_VAR_'),stamps=[];
  for(let at=compiled.indexOf(marker);at!==-1;at=compiled.indexOf(marker,at+1))stamps.push(at+marker.length);
  if(!stamps.length)throw Error('Compiled launcher has no bundle type stamp');
  let stray=0;
  for(let i=0;i<packaged.length;i++)if(packaged[i]!==compiled[i]&&!stamps.some(s=>i>=s&&i<s+3))stray++;
  if(stray)throw Error('Packaged Debian launcher differs from its build output outside the bundle stamp ('+stray+' bytes)');
  const read=buffer=>stamps.map(s=>buffer.subarray(s,s+3).toString('latin1'));
  const result={packaged:read(packaged),compiled:read(compiled)};
  for(const s of stamps)if(!packaged.subarray(s-marker.length,s).equals(marker))throw Error('Packaged Debian launcher lacks the bundle type marker');
  if(!result.packaged.every(v=>v==='DEB'))throw Error('Packaged Debian launcher stamp is '+JSON.stringify(result));
  return result;
}
try{
  report.version=await readBlackcrabVersion();
  const desktop=await verifyArtifact(values.desktop,{expectedTarget:'linux-x64'});
  const host=await verifyServiceProfileArtifact(values.host,{platform:'linux',arch:'x64'});
  report.manifests={desktop:await digest(path.join(values.desktop,'blackcrab-managed-desktop.json')),host:await digest(path.join(values.host,'blackcrab-managed-host.json'))};
  report.files={desktop:desktop.files.length,host:host.files.length};
  await step('tauri-installers',process.execPath,[path.join(repository,'scripts/tauri-build.mjs'),'--local','--target','x86_64-unknown-linux-gnu','--bundles','deb,appimage','--managed-desktop',values.desktop,'--managed-service-host',values.host]);
  const release=path.join(repository,'src-tauri/target/x86_64-unknown-linux-gnu/release');
  const binaryHash=await digest(path.join(release,'blackcrab'));
  report.compiledRootSha256=binaryHash;
  const deb=await one(path.join(release,'bundle/deb'),'.deb'),appimage=await one(path.join(release,'bundle/appimage'),'.AppImage');
  for(const [field,expected] of [['Package','blackcrab'],['Version',report.version],['Architecture','amd64']]){
    const {stdout}=await exec('/usr/bin/dpkg-deb',['-f',deb,field]);if(stdout.trim()!==expected)throw Error('Debian '+field+' mismatch');
  }
  const extractedDeb=path.join(root,'deb'),extractedImage=path.join(root,'image');
  await fs.mkdir(extractedDeb);await fs.mkdir(extractedImage);
  await step('extract-deb','/usr/bin/dpkg-deb',['-x',deb,extractedDeb]);
  await step('extract-appimage',appimage,['--appimage-extract'],extractedImage);
  let payloadHashes;
  for(const [kind,installer,directory] of [['deb',deb,extractedDeb],['appimage',appimage,path.join(extractedImage,'squashfs-root')]]){
    const binary=await named(directory,'blackcrab');
    // linuxdeploy adjusts ELF library paths and strips symbols. Compare the
    // AppImage to Tauri's actual post-packaging AppDir, not the unmodified ELF.
    // Tauri stamps each bundle's type into the launcher in place, so the
    // compiled ELF ends as the last bundle's variant. The Debian launcher
    // must equal it everywhere except that three-byte stamp.
    let rootHash;
    if(kind==='deb'){
      report.debBundleStamp=await bundleStampOnly(binary,path.join(release,'blackcrab'));
      rootHash=await digest(binary);
    }else{
      rootHash=await digest(path.join(release,'bundle/appimage/Blackcrab.AppDir/usr/bin/blackcrab'));
      if(await digest(binary)!==rootHash)throw Error('Packaged AppImage launcher bytes differ from their build output');
    }
    const desktopArchive=await named(directory,'managed-desktop-payload.tar.gz'),hostArchive=await named(directory,'managed-host-payload.tar.gz');
    const hashes={desktop:await digest(desktopArchive),host:await digest(hostArchive)};
    if(payloadHashes && JSON.stringify(hashes)!==JSON.stringify(payloadHashes))throw Error('Installer payload archives differ');
    payloadHashes=hashes;
    if(kind==='deb'){
      for(const [role,archive] of [['desktop',desktopArchive],['host',hostArchive]]){
        const unpack=path.join(root,'verify-'+role);await fs.mkdir(unpack,{mode:0o700});
        await step('verify-extract-'+role,'/usr/bin/tar',['-xzf',archive,'--no-same-owner','-C',unpack]);
        if(await digest(path.join(unpack,`blackcrab-managed-${role}.json`))!==report.manifests[role])throw Error('Bundled manifest differs');
        if(role==='desktop')await verifyArtifact(unpack,{expectedTarget:'linux-x64'});else await verifyServiceProfileArtifact(unpack,{platform:'linux',arch:'x64'});
      }
    }
    report.packages.push({kind,file:installer,bytes:(await fs.stat(installer)).size,sha256:await digest(installer),rootSha256:rootHash,payloadHashes:hashes});
  }
  report.passed=true;
  if(process.env.GITHUB_ENV)await fs.appendFile(process.env.GITHUB_ENV,`BLACKCRAB_LINUX_PACKAGE_REPORT=${path.join(root,'result.json')}\n`);
}catch(error){report.error=error.message;process.exitCode=1;}
await fs.writeFile(path.join(root,'result.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify(report));
