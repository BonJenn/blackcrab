import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {prepareSource} from '../source.mjs';
import {prepareServiceSourceArchive} from '../../managed-host/service-profile.mjs';
import {applySourcePatchRecords} from '../../managed-host/source.mjs';

/** Isolated 0.4.5 source. No release producer imports this recipe. */
export async function preparePairedModelsSource({profile, archive, cacheDir}) {
  if (!['desktop', 'host'].includes(profile)) throw Error('Unknown paired models source profile');
  const prepared = profile === 'desktop'
    ? await prepareSource({archive, cacheDir})
    : await prepareServiceSourceArchive(archive, cacheDir);
  const root = profile === 'desktop' ? prepared.source : prepared.root;
  // The desktop records are in the production desktop registry since 0.4.5 and arrive with
  // prepareSource. Only the host records are still applied from this recipe.
  if (profile === 'desktop') return {root, profile, productionEvidence: prepared, experimentalPatches: [], releaseEligible: true};
  const patchDirectory = fileURLToPath(new URL('./host/', import.meta.url));
  const records = JSON.parse(await fs.readFile(new URL('./host/registry.json', import.meta.url), 'utf8'));
  const experimentalPatches = await applySourcePatchRecords(root, {records, patchDirectory});
  return {root, profile, productionEvidence: prepared, experimentalPatches, releaseEligible: false};
}
