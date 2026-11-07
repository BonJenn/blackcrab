import { parseArgs } from 'node:util';
import { buildSharedRuntime } from '../shared-runtime/export.mjs';
const { values } = parseArgs({ options: { archive: { type: 'string' }, cache: { type: 'string' }, output: { type: 'string' } } });
if (!['archive', 'cache', 'output'].every(key => values[key])) throw new Error('Pass --archive <pinned source tar.gz> --cache <external cache> --output <new vendor directory>');
console.log(JSON.stringify(await buildSharedRuntime({ archive: values.archive, cacheDir: values.cache, output: values.output })));
