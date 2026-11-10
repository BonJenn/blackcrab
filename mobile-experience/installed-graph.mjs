import fs from 'node:fs/promises';
import path from 'node:path';
const groups=['dependencies','devDependencies','optionalDependencies','peerDependencies'];
const safe=p=>typeof p==='string'&&!path.isAbsolute(p)&&!p.includes('\\')&&!p.includes(':')&&p.split('/').every(s=>s&&s!=='.'&&s!=='..');
const inside=(root,p)=>p===root||p.startsWith(root+path.sep);
const canonical=o=>JSON.stringify(Object.fromEntries(Object.entries(o??{}).sort(([a],[b])=>a.localeCompare(b))));
async function maybeStat(file){try{return await fs.lstat(file)}catch(e){if(e.code==='ENOENT')return null;throw e}}
async function json(file){const s=await fs.stat(file);if(!s.isFile()||s.size>16*1024*1024)throw Error('Package metadata is not a bounded regular file');return JSON.parse(await fs.readFile(file,'utf8'))}
function allows(values,current){if(!Array.isArray(values))return true;if(values.includes('!'+current))return false;const positive=values.filter(v=>!v.startsWith('!'));return !positive.length||positive.includes(current)}
function positions(context,name){const out=[];let current=context;for(;;){out.push([current,'node_modules',name].filter(Boolean).join('/'));if(!current)break;const parent=path.posix.dirname(current);current=parent==='.'?'':parent}return out}
async function workspaceFolders(root,patterns){const result=new Set(['']);for(const pattern of patterns){if(!safe(pattern)||pattern.includes('**'))throw Error('Unsupported workspace pattern');let folders=[''];for(const part of pattern.split('/')){const next=[];for(const folder of folders){if(part==='*'){for(const entry of await fs.readdir(path.join(root,folder),{withFileTypes:true}))if(entry.isDirectory()&&entry.name!=='node_modules'&&!entry.name.startsWith('.'))next.push([folder,entry.name].filter(Boolean).join('/'))}else next.push([folder,part].filter(Boolean).join('/'))}folders=next}for(const folder of folders)if(await maybeStat(path.join(root,folder,'package.json')))result.add(folder)}return result}
export class InstalledGraphError extends Error { constructor(report){super('Installed dependency graph differs from the exact package lock');this.name='InstalledGraphError';this.report=report} }
/** Check actual installation topology, not only a matching lockfile digest. No installs/mutations. */
export async function inspectInstalledGraph({repoRoot,platform=process.platform,arch=process.arch}){
 const root=await fs.realpath(repoRoot),lock=await json(path.join(root,'package-lock.json')),manifest=await json(path.join(root,'package.json'));
 if(!lock.packages||![2,3].includes(lock.lockfileVersion))throw Error('Unsupported package lock');
 const packages=lock.packages,workspace=await workspaceFolders(root,Array.isArray(manifest.workspaces)?manifest.workspaces:manifest.workspaces?.packages??[]),contexts=new Set(workspace);
 for(const [location,record] of Object.entries(packages)){
  if(location&&!safe(location))throw Error('Unsafe lock package location');
  if(location&&!location.split('/').includes('node_modules'))contexts.add(location);
  if(record.link){if(!safe(record.resolved))throw Error('Unsafe local package link');contexts.add(record.resolved)}
 }
 const report={ok:false,platform,arch,lockedInstallEntries:0,installedPackageRoots:0,workspaceContexts:workspace.size,nativeFileContexts:contexts.size-workspace.size,contextEdges:0,optionalAbsences:[],packageDiffs:[],resolutionDiffs:[],contexts:[]};
 const observed=new Map(),installRoots=new Set(['node_modules']);
 async function physical(location){if(observed.has(location))return observed.get(location);const dir=path.join(root,location),s=await maybeStat(dir);if(!s){observed.set(location,null);return null}let value;try{const real=await fs.realpath(dir);if(!inside(root,real))throw Error('Package escapes staged root');const m=await json(path.join(real,'package.json'));value={location,resolved:path.relative(root,real).split(path.sep).join('/'),name:m.name,version:m.version};}catch(error){value={location,invalid:true,error:error.message}}observed.set(location,value);return value}
 for(const [location,record] of Object.entries(packages)){
  if(!location.split('/').includes('node_modules'))continue;
  report.lockedInstallEntries++;
  const parts=location.split('/');installRoots.add(parts.slice(0,parts.indexOf('node_modules')+1).join('/'));
  const actual=await physical(location),expected=record.link?record.resolved:location;
  if(!actual){if(record.optional===true)report.optionalAbsences.push({location,reason:allows(record.os,platform)&&allows(record.cpu,arch)?'explicit-optional':'optional-platform',os:record.os,cpu:record.cpu});else report.packageDiffs.push({location,kind:'missing-required-package'});continue}
  const expectedVersion=record.link?packages[expected]?.version:record.version;
  const expectedName=record.name??location.split('node_modules/').at(-1);
  if(actual.invalid||actual.resolved!==expected||actual.name!==expectedName||expectedVersion&&actual.version!==expectedVersion)report.packageDiffs.push({location,kind:'package-layout-or-version',expected:{resolved:expected,name:expectedName,version:expectedVersion},actual});
 }
 const seenDirs=new Set();
 async function scanModules(location){const dir=path.join(root,location),s=await maybeStat(dir);if(!s)return;if(!s.isDirectory()||s.isSymbolicLink()){report.packageDiffs.push({location,kind:'linked-install-root'});return}const real=await fs.realpath(dir);if(seenDirs.has(real))return;seenDirs.add(real);
  for(const entry of await fs.readdir(dir,{withFileTypes:true})){if(entry.name.startsWith('.'))continue;const children=entry.name.startsWith('@')?(await fs.readdir(path.join(dir,entry.name))).map(name=>entry.name+'/'+name):[entry.name];for(const name of children){const loc=location+'/'+name,p=path.join(root,loc);if(!await maybeStat(path.join(p,'package.json')))continue;report.installedPackageRoots++;const a=await physical(loc);if(!packages[loc])report.packageDiffs.push({location:loc,kind:'unlocked-installed-package',actual:a});if(!(await fs.lstat(p)).isSymbolicLink())await scanModules(loc+'/node_modules');}}
 }
 for(const context of contexts){for(const p of positions(context,'_probe_'))installRoots.add(path.posix.dirname(p));}
 for(const location of [...installRoots].sort())await scanModules(location);
 for(const context of [...contexts].sort()){
  const file=path.join(root,context,'package.json');if(!await maybeStat(file)){report.resolutionDiffs.push({context,kind:'missing-declared-context'});continue}
  const m=await json(file),record=packages[context];if(!record){report.resolutionDiffs.push({context,kind:'context-missing-from-lock'});continue}
  if(record.version&&m.version!==record.version)report.resolutionDiffs.push({context,kind:'context-version',expected:record.version,actual:m.version});
  if(workspace.has(context))for(const group of groups)if(canonical(m[group])!==canonical(record[group]))report.resolutionDiffs.push({context,kind:'manifest-lock-declarations',group});
  const names=new Set(groups.flatMap(group=>Object.keys(m[group]??{})));const row={context,dependencies:[]};
  for(const name of [...names].sort()){
   if(!safe(name)||name.split('/').length>(name.startsWith('@')?2:1))throw Error('Unsafe dependency name');
   const candidates=positions(context,name),expectedLoc=candidates.find(p=>packages[p]),expectedRecord=expectedLoc?packages[expectedLoc]:null;
   let actual=null;for(const loc of candidates){actual=await physical(loc);if(actual)break}
   const optional=Object.hasOwn(m.optionalDependencies??{},name)||m.peerDependenciesMeta?.[name]?.optional===true;
   const devNativeOnly=!workspace.has(context)&&Object.hasOwn(m.devDependencies??{},name)&&!Object.hasOwn(m.dependencies??{},name)&&!Object.hasOwn(m.peerDependencies??{},name);
   if(!expectedRecord&&!actual&&(optional||devNativeOnly))continue;
   report.contextEdges++;
   const resolved=expectedRecord?.link?expectedRecord.resolved:expectedLoc,version=expectedRecord?.link?packages[resolved]?.version:expectedRecord?.version;
   row.dependencies.push({name,expected:expectedLoc,actual:actual?.location??null,version:actual?.version??null});
   if(!expectedRecord||!actual&&!optional||actual&&(actual.invalid||actual.location!==expectedLoc||actual.resolved!==resolved||version&&actual.version!==version))report.resolutionDiffs.push({context,dependency:name,kind:'nearest-resolution',expected:{location:expectedLoc,resolved,version},actual});
  }
  report.contexts.push(row);
 }
 report.ok=!report.packageDiffs.length&&!report.resolutionDiffs.length;return report;
}
export async function verifyInstalledGraph(options){const report=await inspectInstalledGraph(options);if(!report.ok)throw new InstalledGraphError(report);return report}
