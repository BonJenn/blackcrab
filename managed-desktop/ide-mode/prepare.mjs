import {prepareSource} from '../source.mjs';
import {applyIdeMode} from './apply.mjs';
/** Isolated 0.4.5 source experiment; deliberately unavailable to release builders. */
export async function prepareIdeSource(options) {
 const result=await prepareSource(options);
 const experimentalPatches=await applyIdeMode(result.source);
 return {...result,experimentalPatches,releaseEligible:false};
}
