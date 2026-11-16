import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {applySourcePatchRecords} from '../managed-host/source.mjs';
import {preparePairedModelsSource} from './paired-models/prepare.mjs';
import {fileURLToPath} from 'node:url';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
test('paired service records apply exactly and authenticate their payloads', async () => {
  const directory = fileURLToPath(new URL('../managed-host/features/', import.meta.url));
  const records = JSON.parse(await fs.readFile(path.join(directory, 'registry.json'), 'utf8')).filter(record => record.id.startsWith('paired-models-045-'));
  assert.equal(records.length, 7);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blackcrab-paired-recipe-'));
  try {
    for (const record of records) {
      assert.equal(sha(await fs.readFile(path.join(directory, record.file))), record.sha256);
      const before = record.replacements[0].before;
      assert.equal(sha(before), record.beforeSha256);
      const target = path.join(root, record.target);
      await fs.mkdir(path.dirname(target), {recursive: true});
      await fs.writeFile(target, before);
    }
    await applySourcePatchRecords(root, {records, patchDirectory: directory});
    for (const record of records) assert.equal(sha(await fs.readFile(path.join(root, record.target))), record.afterSha256);
    await assert.rejects(applySourcePatchRecords(root, {records, patchDirectory: directory}));
  } finally {
    await fs.rm(root, {recursive: true, force: true});
  }
});

test('the production desktop registry carries the ten paired desktop records', async () => {
  const production = JSON.parse(await fs.readFile(new URL('./patches/registry.json', import.meta.url), 'utf8'))
    .filter(record => record.id.startsWith('paired-models-045-'));
  assert.equal(production.length, 10);
  for (const record of production) {
    assert.match(record.file, /^paired-models\/paired-models-045-[A-Za-z-]+\.(patch|payload)$/);
    assert.equal(sha(await fs.readFile(new URL('./patches/' + record.file, import.meta.url))), record.sha256);
  }
  assert.deepEqual(production.filter(record => record.kind === 'payload').map(record => record.target), [
    'apps/web/src/components/chat/PairedModelPicker.tsx',
    'apps/web/src/components/chat/PairedModelPicker.browser.test.tsx',
    'apps/web/test/pairedModels.config.ts',
  ]);
});

test('the service profile carries the paired records, after every 0.4.4 record', async () => {
  const {serviceProfilePlan} = await import('../managed-host/service-profile.mjs');
  const plan = await serviceProfilePlan('linux');
  assert.equal(plan.records.length, 82);
  assert.deepEqual(plan.records.slice(75).map(record => record.id.replace('paired-models-045-', '')),
    ['ServerEnvironment-ts', 'Orchestrator-ts', 'ThreadLaunchService-ts', 'ThreadManagementService-ts', 'ProviderSwitch-integration-test-ts', 'composerContext-ts', 'environment-ts']);
});

test('unknown paired source profiles fail before preparing source', async () => {
  await assert.rejects(preparePairedModelsSource({profile: 'production'}), /Unknown paired/);
});
