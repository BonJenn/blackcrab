import {parseArgs} from 'node:util';
import {buildManagedDesktop} from '../managed-desktop/build.mjs';
const {values}=parseArgs({options:Object.fromEntries(['archive','cache','output','node','pnpm','electron-archive','dependency-cache','secondary-dependency-cache'].map(key=>[key,{type:'string'}]))});
if(!['archive','cache','output','node','pnpm','electron-archive'].every(key=>values[key]))throw Error('Pass --archive --cache --output --node --pnpm --electron-archive (absolute paths); optional --dependency-cache is read-only');
console.log(JSON.stringify(await buildManagedDesktop({archive:values.archive,cacheDir:values.cache,output:values.output,node:values.node,pnpm:values.pnpm,electronArchive:values['electron-archive'],dependencyCache:values['dependency-cache'],secondaryDependencyCache:values['secondary-dependency-cache']})));
