import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {UPSTREAM} from '../managed-host/artifact.mjs';
import {extractPinnedSourceArchive, applySourcePatchRecords} from '../managed-host/source.mjs';

const patchDirectory = fileURLToPath(new URL('./patches/', import.meta.url));
const sha256 = value => createHash('sha256').update(value).digest('hex');

async function relayFiles(root) {
  const records = [];
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, {withFileTypes: true})) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) records.push({path: path.relative(root, absolute).split(path.sep).join('/'), sha256: sha256(await fs.readFile(absolute))});
      else throw new Error('Unexpected relay source entry');
    }
  }
  await visit(path.join(root, 'infra/relay'));
  return records.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

/** Extract the original backend and workspace lockfile without installing or deploying. */
export async function prepareCloudSource({archive, cacheDir}) {
  const {root} = await extractPinnedSourceArchive(archive, cacheDir);
  const before = await relayFiles(root);
  const records = JSON.parse(await fs.readFile(path.join(patchDirectory, 'registry.json'), 'utf8'));
  const sourcePatches = await applySourcePatchRecords(root, {records, patchDirectory});
  const after = await relayFiles(root);
  const expected = new Map(records.map(record => [record.target, record.afterSha256]));
  if (after.length !== before.length || before.some((file, index) => file.path !== after[index].path || after[index].sha256 !== (expected.get(file.path) ?? file.sha256))) {
    throw new Error('Cloud preparation changed source outside its reviewed patches');
  }
  const manifest = {
    schema: 1, kind: 'blackcrab-cloud-source', upstream: UPSTREAM,
    sourcePatches, sourceFiles: after, originalSourceFiles: before,
    workspaceLockSha256: sha256(await fs.readFile(path.join(root, 'pnpm-lock.yaml'))),
    deploymentEntry: 'infra/relay/alchemy.run.ts',
    stackName: 'BlackcrabConnectRelay', databaseName: 'blackcrabconnectrelay',
    clientConfigurationOutputVariable: 'BLACKCRAB_RELAY_CLIENT_CONFIG_ENV',
    dependenciesInstalled: false, typecheckPassed: false, deployed: false,
  };
  const manifestPath = path.join(root, 'blackcrab-cloud-source.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  return {root, manifestPath, manifest};
}
