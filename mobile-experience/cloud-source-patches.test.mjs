import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { mobileCloudPatchRecords, mobileCloudPatchDescriptors, applyMobileCloudSourcePatches, validateMobileCloudSourcePatch } from './cloud-source-patches.mjs';

test('mobile consumes the desktop shared implementation with recorded originals and exact validation', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blackcrab-mobile-cloud-patches-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const records = await mobileCloudPatchRecords();
  for (const record of records) {
    assert.equal(record.replacements.length, 1);
    await fs.mkdir(path.dirname(path.join(root, record.target)), { recursive: true });
    await fs.writeFile(path.join(root, record.target), record.replacements[0].before);
  }
  const result = await applyMobileCloudSourcePatches(root);
  assert.deepEqual(result.patches, await mobileCloudPatchDescriptors());
  assert.equal(result.patches.length, 12);
  for (const [index, patch] of result.patches.entries()) {
    const before = result.originals[index].bytes, after = await fs.readFile(path.join(root, patch.target));
    await validateMobileCloudSourcePatch(before, after, patch);
    await assert.rejects(validateMobileCloudSourcePatch(before, Buffer.concat([after, Buffer.from('// drift')]), patch), /result differs/);
    await assert.rejects(validateMobileCloudSourcePatch(before, after, { ...patch, kind: 'type-only' }), /Unregistered/);
  }
  await assert.rejects(applyMobileCloudSourcePatches(root), /Pinned source differs/);
});
