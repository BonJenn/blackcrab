import { verifySharedRuntime } from '../shared-runtime/verify.mjs';
if (process.argv.length !== 3) throw new Error('Pass the shared native runtime source directory');
console.log(JSON.stringify(await verifySharedRuntime(process.argv[2])));
