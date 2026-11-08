import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyExperienceConsumers } from './consumer.mjs';
import {applyOwnedMobileBuildPatches} from './build-patches.mjs';
import { applyDependencyPatchRegistry } from './dependency-patches.mjs';
const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const vendorRoot = path.join(repoRoot, 'vendor/t3-mobile');
await verifyExperienceConsumers(vendorRoot);
const registry = JSON.parse(await fs.readFile(new URL('./dependency-patches.registry.json', import.meta.url), 'utf8'));
console.log(await applyDependencyPatchRegistry({ repoRoot, vendorRoot, registry }));

console.log(await applyOwnedMobileBuildPatches({repoRoot}));
