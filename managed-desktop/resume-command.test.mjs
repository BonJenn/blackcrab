import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest('hex');
const registry=JSON.parse(await fs.readFile(new URL('./patches/registry.json',import.meta.url),'utf8'));
const entries=registry.filter(patch=>patch.id.startsWith('resume-command-'));
const final=target=>registry.filter(patch=>patch.target===target).at(-1).replacements.at(-1).after;
const source=suffix=>final('apps/web/src/'+suffix);

test('the /resume command is four patches whose digests and diffs match',async()=>{
 assert.deepEqual(entries.map(entry=>entry.target.replace('apps/web/src/','')).sort(),['components/chat/ChatComposer.tsx','components/chat/useComposerMenuItems.ts','components/chat/useComposerSend.ts','composer-logic.ts']);
 for(const entry of entries){
  const diff=await fs.readFile(new URL('./patches/'+entry.file,import.meta.url));
  assert.equal(sha(diff),entry.sha256);
  const [{before,after}]=entry.replacements;
  assert.equal(sha(before),entry.beforeSha256);assert.equal(sha(after),entry.afterSha256);
  assert.match(diff.toString(),/resume/i);
 }
});

test('each patch comes last for its file, so the build applies it on the final earlier state',()=>{
 for(const entry of entries){
  const sameTarget=registry.filter(patch=>patch.target===entry.target);
  assert.equal(sameTarget.at(-1).id,entry.id);
  if(sameTarget.length>1)assert.equal(sameTarget.at(-2).afterSha256,entry.beforeSha256);
 }
});

test('/resume opens the conversation search for every provider, at the message start only',()=>{
 const menu=source('components/chat/useComposerMenuItems.ts');
 assert.match(menu,/composerTrigger\.rangeStart === 0[\s\S]{0,400}id: "slash:resume"[\s\S]{0,200}command: "resume"/);
 assert.match(menu,/item\.command\.name !== "resume"/,'the provider command of the same name is hidden');
 const composer=source('components/chat/ChatComposer.tsx');
 assert.match(composer,/item\.command === "resume"[\s\S]{0,600}openCommandPalette\(\)/);
 assert.match(composer,/import \{ openCommandPalette \} from "\.\.\/\.\.\/commandPaletteBus";/);
 const send=source('components/chat/useComposerSend.ts');
 assert.match(send,/composerHoldsOnlyText && \/\^\\\/resume\\s\*\$\/i\.test\(trimmed\)[\s\S]{0,400}openCommandPalette\(\);\s+return;/);
 const logic=source('composer-logic.ts');
 assert.match(logic,/"clear" \| "resume";/);
 assert.match(logic,/"side" \| "btw" \| "clear" \| "resume"> \| null/,'/resume is not a standalone mode command');
});

test('typing /resume as the whole message is recognised and nothing else is',()=>{
 const pattern=/^\/resume\s*$/i;
 for(const text of ['/resume','/RESUME','/resume  ']) assert.ok(pattern.test(text.trim()),text);
 for(const text of ['/resume please','resume','/resumes','say /resume']) assert.ok(!pattern.test(text.trim()),text);
});
