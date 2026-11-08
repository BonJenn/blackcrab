import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const quote = value => "'" + value.replaceAll("'", "'\"'\"'") + "'";

test('tool versions can be checked from an npm-managed project without running project hooks', { skip: process.platform === 'win32' }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blackcrab-toolchain-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = path.join(root, 'project'); await fs.mkdir(project);
  const manifest = JSON.stringify({ packageManager: 'npm@12.2.2', scripts: { preinstall: 'must-never-run' } });
  await fs.writeFile(path.join(project, 'package.json'), manifest);
  const node = path.join(root, 'node'), pnpm = path.join(root, 'pnpm'), recorded = path.join(root, 'cwd.txt');
  await fs.writeFile(node, `#!/bin/sh\nif [ "$1" = --version ]; then echo v26.12.1; else echo ${process.platform}-${process.arch}; fi\n`, { mode: 0o700 });
  await fs.writeFile(pnpm, `#!/bin/sh\n[ ! -f package.json ] || exit 9\nprintf '%s' "$PWD" > ${quote(recorded)}\necho 12.14.0\n`, { mode: 0o700 });
  const module = new URL('./build.mjs', import.meta.url).href;
  const code = `import {validateToolchain} from ${JSON.stringify(module)}; await validateToolchain(${JSON.stringify(node)}, ${JSON.stringify(pnpm)});`;
  await exec(process.execPath, ['--input-type=module', '-e', code], { cwd: project });
  const toolCwd = await fs.readFile(recorded, 'utf8');
  assert.notEqual(toolCwd, project);
  await assert.rejects(fs.stat(toolCwd), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(project, 'package.json'), 'utf8'), manifest);
});
