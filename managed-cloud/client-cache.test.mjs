import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { saveWebCache, restoreWebCache } from '../managed-desktop/web-cache.mjs';
import { clientCloudConfigFromEnvironment } from './client-config.mjs';

const cloud = clientCloudConfigFromEnvironment({
  BLACKCRAB_CLERK_PUBLISHABLE_KEY: 'pk_test_Y2xlcmsuYmxhY2tjcmFiLmV4YW1wbGUk',
  BLACKCRAB_CLERK_JWT_TEMPLATE: 'blackcrab-relay',
  BLACKCRAB_RELAY_URL: 'https://relay.blackcrab.example',
  BLACKCRAB_HOSTED_APP_URL: 'https://app.blackcrab.example',
  BLACKCRAB_CLERK_CLI_OAUTH_CLIENT_ID: 'oac_blackcrab',
});

test('a cached client restores only for its cloud configuration and rejects damaged output', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blackcrab-cloud-cache-test-'));
  try {
    const source = path.join(root, 'source'), cache = path.join(root, 'cache');
    await fs.mkdir(cache);
    const patches = new URL('../managed-desktop/patches/', import.meta.url);
    const records = JSON.parse(await fs.readFile(new URL('registry.json', patches), 'utf8'));
    const targets = new Map(records.filter(record => !record.target.startsWith('apps/desktop/')).map(record => [record.target, record]));
    for (const [target, record] of targets) {
      const file = path.join(source, target);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, record.kind === 'payload'
        ? await fs.readFile(new URL(record.file, patches))
        : record.replacements.at(-1).after);
    }
    const dist = path.join(source, 'apps/web/dist');
    await fs.mkdir(dist, { recursive: true });
    await fs.writeFile(path.join(dist, 'index.html'), 'configured-client-fixture');
    const saved = await saveWebCache(source, cache, { cloud });
    await fs.rename(dist, path.join(root, 'original'));
    for (const other of [null,
      { ...cloud, hostedAppUrl: 'https://other.example' },
      { ...cloud, relayUrl: 'https://other-relay.example' },
      { ...cloud, publishableKey: 'pk_test_b3RoZXIuZXhhbXBsZSQ=' },
      { ...cloud, jwtTemplate: 'other-template' },
      { ...cloud, cliOAuthClientId: 'oac_other' },
    ]) assert.equal(await restoreWebCache(source, cache, { cloud: other }), false);
    assert.equal(await restoreWebCache(source, cache, { cloud }), true);
    assert.equal(await fs.readFile(path.join(dist, 'index.html'), 'utf8'), 'configured-client-fixture');
    await fs.rename(dist, path.join(root, 'restored'));
    await fs.writeFile(path.join(saved, 'client/index.html'), 'damaged');
    await assert.rejects(restoreWebCache(source, cache, { cloud }), /integrity mismatch/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
