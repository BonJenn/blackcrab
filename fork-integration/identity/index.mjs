import fs from 'node:fs';
import {createHash} from 'node:crypto';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const registry = JSON.parse(fs.readFileSync(new URL('./registry.json', import.meta.url)));
export const identityPatchDescriptors = () => structuredClone(registry.patches);
/** Pure, fail-closed transformation; callers own staging and producer-specific registries. */
export function applyIdentityPatch(original, descriptor) {
  const expected = registry.patches.find(p => p.id === (typeof descriptor === 'string' ? descriptor : descriptor?.id));
  if (!expected || (typeof descriptor !== 'string' && JSON.stringify(descriptor) !== JSON.stringify(expected))) throw new Error('Unknown identity patch descriptor');
  const diff = fs.readFileSync(new URL(expected.patch, import.meta.url));
  if (sha(diff) !== expected.sha256) throw new Error('Identity patch diff changed');
  const bytes = Buffer.from(original);
  if (sha(bytes) !== expected.beforeSha256) throw new Error('Identity source differs before patch');
  let text = bytes.toString('utf8');
  for (const {before, after} of expected.replacements) {
    if (text.split(before).length !== 2) throw new Error('Identity replacement is not unique');
    text = text.replace(before, after);
  }
  const patched = Buffer.from(text);
  if (sha(patched) !== expected.afterSha256) throw new Error('Identity source differs after patch');
  return patched;
}
