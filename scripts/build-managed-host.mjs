import { parseArgs } from 'node:util';
import { buildManagedHost } from '../managed-host/build.mjs';
const { values } = parseArgs({ options: { archive: { type: 'string' }, cache: { type: 'string' }, output: { type: 'string' }, node: { type: 'string' }, pnpm: { type: 'string' }, 'node-license': { type: 'string' } } });
if (Object.values(values).length !== 6 || !['archive', 'cache', 'output', 'node', 'pnpm', 'node-license'].every(key => values[key])) throw new Error('Pass --archive <pinned tar.gz> --cache <build cache> --output <new artifact directory> --node <Node 26.12.1> --pnpm <pnpm 12.14.0 executable> --node-license <selected Node distribution LICENSE>');
console.log(JSON.stringify(await buildManagedHost({ archive: values.archive, cacheDir: values.cache, output: values.output, node: values.node, pnpm: values.pnpm, nodeLicense: values['node-license'] })));
