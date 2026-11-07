import { verifyArtifact } from '../managed-host/artifact.mjs';
if (process.argv.length !== 3) throw new Error('Pass the managed-host artifact directory');
const manifest = await verifyArtifact(process.argv[2]);
console.log(JSON.stringify({ verified: true, upstream: manifest.upstream, runtime: manifest.runtime, files: manifest.files.length }));
