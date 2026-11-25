import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const registry = JSON.parse(await fs.readFile(new URL('./patches/registry.json', import.meta.url)));

test('desktop renderer applies the same subagent actions to sidebar and chat', async () => {
  for (const name of ['SidebarSubagents.tsx', 'V2LifecycleRow.tsx']) {
    const patch = registry.findLast(record => record.target.endsWith('/' + name));
    const source = patch.kind === 'payload'
      ? await fs.readFile(new URL('./patches/' + patch.file, import.meta.url), 'utf8')
      : patch.replacements.map(change => change.after).join('\n');
    assert.match(source, /useSubagentActions\(/);
  }
  const actions = registry.findLast(record => record.target.endsWith('/useSubagentActions.ts'));
  const source = await fs.readFile(new URL('./patches/' + actions.file, import.meta.url), 'utf8');
  for (const label of ['Make a pane', 'Make a new window']) assert.ok(source.includes(label));
  assert.match(source, /dropThreadContext\(/);
});
