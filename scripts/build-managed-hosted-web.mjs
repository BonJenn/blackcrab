import { parseArgs } from 'node:util';
import { buildHostedWeb } from '../managed-cloud/hosted-build.mjs';

const { values } = parseArgs({ options: {
  archive: { type: 'string' }, cache: { type: 'string' }, output: { type: 'string' },
  node: { type: 'string', default: process.execPath }, pnpm: { type: 'string' },
} });
for (const name of ['archive', 'cache', 'output', 'pnpm']) if (!values[name]) throw new Error(`Pass --${name}.`);
console.log(JSON.stringify(await buildHostedWeb({ archive: values.archive, cacheDir: values.cache, output: values.output, node: values.node, pnpm: values.pnpm }), null, 2));
