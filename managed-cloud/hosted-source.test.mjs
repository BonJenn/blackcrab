import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { applySourcePatchRecords } from '../managed-host/source.mjs';

const desktop = JSON.parse(await fs.readFile(new URL('../managed-desktop/patches/registry.json', import.meta.url), 'utf8'));
const hosted = JSON.parse(await fs.readFile(new URL('./hosted-patches/registry.json', import.meta.url), 'utf8'));
const patchDirectory = fileURLToPath(new URL('./hosted-patches/', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

// Compose the real shared-branding outputs with every overlapping hosted patch.
// Independent config tests cannot catch a stale source predecessor between layers.
test('hosted patches compose with current shared-client branding and setup', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blackcrab-hosted-chain-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const overlapping = hosted.filter(p => desktop.some(d => d.target === p.target && d.id.startsWith("blackcrab-ui-copy-")));
  assert.equal(overlapping.length, 3);
  for (const target of new Set(overlapping.map(p => p.target))) {
    const latest = desktop.findLast(p => p.target === target);
    const output = latest.replacements[0].after;
    assert.equal(hash(output), latest.afterSha256, 'Use the complete authenticated shared-client output');
    const destination = path.join(root, target);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, output);
  }
  await applySourcePatchRecords(root, { records: overlapping, patchDirectory });
  const read = name => fs.readFile(path.join(root, 'apps/web/src', name), 'utf8');
  const privacy = await read('legalLinks.ts');
  assert.match(privacy, /__BLACKCRAB_PRIVACY_POLICY_URL__/);
  assert.doesNotMatch(privacy, /https:\/\//, 'Hosted privacy stays explicitly configured');
  const welcome = await read('components/onboarding/WelcomeWizard.tsx');
  assert.match(welcome, /title="Set up Blackcrab"/);
  assert.match(welcome, /Sharing &amp; access/);
  assert.match(welcome, /how Blackcrab handles your data/);
  assert.match(welcome, /<T3Wordmark/, 'The shared component now renders the owned Blackcrab mark');
  const empty = await read('components/HostedEmptyState.tsx');
  assert.match(empty, /DesktopInstructions mode="connect"/);
  assert.match(empty, /DesktopInstructions mode="pair"/);
  for (const text of [welcome, empty]) assert.doesNotMatch(text, /npx t3|CommandBlock|T3 Code/);
});
