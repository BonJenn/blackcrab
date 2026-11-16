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
for (const profile of ['desktop', 'host']) {
  test(`paired ${profile} patches apply exactly and authenticate their payloads`, async () => {
    const directory = fileURLToPath(new URL(`./paired-models/${profile}/`, import.meta.url));
    const records = JSON.parse(await fs.readFile(path.join(directory, 'registry.json'), 'utf8'));
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blackcrab-paired-recipe-'));
    try {
      for (const record of records) {
        assert.equal(sha(await fs.readFile(path.join(directory, record.file))), record.sha256);
        if (record.kind === 'payload') continue;
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
}

test('the production desktop registry carries exactly the paired desktop records', async () => {
  const production = JSON.parse(await fs.readFile(new URL('./patches/registry.json', import.meta.url), 'utf8'));
  const desktop = JSON.parse(await fs.readFile(new URL('./paired-models/desktop/registry.json', import.meta.url), 'utf8'));
  assert.deepEqual(
    production.filter(record => record.id.startsWith('paired-models-045-')),
    desktop.map(record => ({...record, file: '../paired-models/desktop/' + record.file})),
  );
});

test('the service recipe does not carry paired models until the host records are promoted', async () => {
  for (const file of ['../managed-host/service-profile.mjs', '../managed-host/patches/registry.json']) {
    assert.doesNotMatch(await fs.readFile(new URL(file, import.meta.url), 'utf8'), /paired-models|preparePairedModels/);
  }
});

test('unknown paired source profiles fail before preparing source', async () => {
  await assert.rejects(preparePairedModelsSource({profile: 'production'}), /Unknown paired/);
});
