import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const ts = createRequire(import.meta.url)('typescript');
const registry = JSON.parse(await fs.readFile(new URL('./patches/registry.json', import.meta.url), 'utf8'));
const helperSource = await fs.readFile(new URL('./runtime/importedTaskNotification.ts', import.meta.url), 'utf8');
function evaluate(source, requireModule = name => { throw Error('Unexpected import ' + name); }) {
  const code = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS}}).outputText;
  const exports = {};
  new Function('exports', 'require', code)(exports, requireModule);
  return exports;
}
const helper = evaluate(helperSource);
const final = target => registry.filter(p => p.target === target).at(-1).replacements.at(-1).after;
const presentation = evaluate(final('packages/client-runtime/src/userMessage.ts'), name => {
  if (name === './importedTaskNotification.ts') return helper;
  if (name === '@t3tools/contracts') return {ScheduledTaskId: {make: value => value}};
  if (name === '@t3tools/shared/composerContextReferences') return {isAttachmentOnlyBootstrapPrompt: () => false};
  if (['@t3tools/shared/filePreview', '@t3tools/shared/image', '@t3tools/shared/video'].includes(name)) return {};
  throw Error('Unexpected import ' + name);
});
const raw = `<task-notification> <task-id>monitor-123</task-id> <summary>Monitor event: "support updates"</summary> <event>New message: order example needs a reply.</event> If this event is something the user would act on now, send a PushNotification. Routine or benign output doesn't need one. </task-notification>`;
const imported = {id: 'import:claudeAgent:session-example:000042', role: 'user', createdBy: 'user', creationSource: 'server', text: raw, attachments: []};
test('old imported monitor envelopes become background activity with original text retained', () => {
  const before = JSON.stringify(imported);
  const result = presentation.resolveUserMessagePresentation(imported);
  assert.equal(result.attribution, 'automation');
  assert.equal(result.scheduledTaskId, undefined);
  assert.equal(result.text, raw);
  assert.deepEqual(result.backgroundNotification, {summary: 'Monitor event: "support updates"', event: 'New message: order example needs a reply.'});
  assert.equal(JSON.stringify(imported), before);
  assert.deepEqual(presentation.resolveUserMessageGrouping(imported, {role: 'user', text: 'hello'}, {role: 'user', text: 'hello'}), {groupedWithPrevious: false, groupedWithNext: false, continuesSteer: false});
});
test('ordinary pasted, quoted, malformed and unrelated messages are preserved', () => {
  const cases = [
    {...imported, id: 'new-user-message'}, {...imported, creationSource: 'web'},
    {...imported, creationSource: 'mobile'}, {...imported, role: 'assistant'},
    {...imported, createdBy: 'agent'}, {...imported, createdBy: undefined},
    {...imported, attachments: [{type: 'image'}]},
    ...['Please inspect: ' + raw, '```xml\n' + raw + '\n```', raw + raw,
      raw.replace('</event>', ''), raw.replace('Monitor event:', 'Task complete:'),
      raw.replace('monitor-123', '<unknown>'), raw.replace('New message: order example needs a reply.', '   '),
      raw.replace("Routine or benign output doesn't need one.", 'Different instructions.'),
      raw.replace('New message: order example needs a reply.', 'x'.repeat(65536))]
      .map(text => ({...imported, text})),
  ];
  for (const candidate of cases) {
    assert.equal(helper.importedTaskNotification(candidate), undefined);
    assert.equal(presentation.resolveUserMessagePresentation(candidate).text, candidate.text);
  }
});
test('guest and scheduled attribution take precedence over legacy recognition', () => {
  assert.equal(presentation.resolveUserMessagePresentation({...imported, scheduledTaskId: 'scheduled'}).backgroundNotification, undefined);
  const guest = presentation.resolveUserMessagePresentation({...imported, context: {guest: {name: 'Visitor', text: raw}}});
  assert.equal(guest.attribution, 'guest'); assert.equal(guest.text, raw);
});
test('renderer keeps accessible collapsed summary, readable event and inspectable original', () => {
  const source = final('apps/web/src/components/chat/TimelineUserMessageRow.tsx');
  assert.match(source, /backgroundNotification\?\.summary/);
  assert.match(source, /"Background update"/);
  assert.match(source, /text=\{backgroundNotification\.event\}/);
  assert.match(source, /<summary>Original notification<\/summary>/);
  assert.match(source, /<pre[^>]+>\{text\}<\/pre>/);
  assert.match(source, /expanded=\{expanded\}/);
});
