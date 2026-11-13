import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const registry=JSON.parse(await fs.readFile(new URL('./patches/registry.json',import.meta.url),'utf8'));
const source=target=>registry.filter(p=>p.target===target).at(-1).replacements.at(-1).after;
test('pane controls use header flow when closed and pane-relative placement when open',()=>{
 const view=source('apps/web/src/components/ChatView.tsx');
 assert.match(view,/placement=\{pane === null \? "window" : rightPanelControlsAtRoot \? "pane" : "inline"\}/);
 assert.match(view,/reservePanelControls=\{pane === null\}/);
 assert.match(view,/inline=\{pane !== null\}/);
 const actions=view.indexOf('{pane ? <PaneHeaderControls');
 assert.ok(actions>0);
 assert.ok(view.indexOf('{pane !== null && !rightPanelControlsAtRoot',actions)>actions);
 const controls=source('apps/web/src/components/chat/PanelLayoutControls.tsx');
 assert.match(controls,/props\.placement === "inline"/);
 assert.match(controls,/props\.placement === "pane"/);
 assert.match(controls,/"absolute top-0 right-3"/);
 assert.match(source('apps/web/src/components/panes/PaneHeaderControls.tsx'),/\[-webkit-app-region:no-drag\]/);
});
