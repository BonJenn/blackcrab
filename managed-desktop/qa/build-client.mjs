import {parseArgs} from 'node:util';import {buildManagedDesktop} from '../build.mjs';
const {values:v}=parseArgs({options:Object.fromEntries(['archive','cache','output','node','pnpm','electron-archive','dependency-cache','secondary-dependency-cache'].map(k=>[k,{type:'string'}]))});
console.log(JSON.stringify(await buildManagedDesktop({archive:v.archive,cacheDir:v.cache,output:v.output,node:v.node,pnpm:v.pnpm,electronArchive:v['electron-archive'],dependencyCache:v['dependency-cache'],secondaryDependencyCache:v['secondary-dependency-cache'],qa:true})));
