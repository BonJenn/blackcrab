import { fileURLToPath } from 'node:url';
import { prepareMobileResources } from './resources.mjs';
if (process.argv.length !== 2) throw new Error('Usage: node mobile-experience/resources-cli.mjs');
console.log(await prepareMobileResources(fileURLToPath(new URL('../', import.meta.url))));
