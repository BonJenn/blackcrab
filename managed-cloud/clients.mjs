import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareSource } from '../managed-desktop/source.mjs';

/** Prepare the pinned client source and its focused cloud integration tests. */
export async function prepareCloudClients({ archive, cacheDir }) {
  const prepared = await prepareSource({ archive, cacheDir });
  await fs.copyFile(new URL('./client-tests.config.ts', import.meta.url), path.join(prepared.source, 'blackcrab-cloud-test.config.ts'));
  return prepared;
}
