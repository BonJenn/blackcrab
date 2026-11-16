import {prepareSource} from '../source.mjs';
import {prepareServiceSourceArchive} from '../../managed-host/service-profile.mjs';

/** The production source for either side. Since 0.4.5 both recipes carry paired models themselves. */
export async function preparePairedModelsSource({profile, archive, cacheDir}) {
  if (!['desktop', 'host'].includes(profile)) throw Error('Unknown paired models source profile');
  const prepared = profile === 'desktop'
    ? await prepareSource({archive, cacheDir})
    : await prepareServiceSourceArchive(archive, cacheDir);
  return {root: profile === 'desktop' ? prepared.source : prepared.root, profile, productionEvidence: prepared, experimentalPatches: [], releaseEligible: true};
}
