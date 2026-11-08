import { fileURLToPath } from 'node:url';
import { prepareMobileResources } from './resources.mjs';
import { ensureNativeUI } from './activation/ensure.mjs';
import { verifyMobileResources } from './resources-check.mjs';
if (process.argv.length > 3 || (process.argv[2] && !['--ui-only','--verify'].includes(process.argv[2]))) throw new Error('Usage: node mobile-experience/resources-cli.mjs [--ui-only|--verify]');
const root = fileURLToPath(new URL('../', import.meta.url));
console.log(process.argv[2] === '--verify' ? await verifyMobileResources(root) : process.argv[2] === '--ui-only' ? await ensureNativeUI(root) : await prepareMobileResources(root));
