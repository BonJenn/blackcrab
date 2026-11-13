# Split-pane toolbar placement

The owner reported that the rightmost pane's close and move controls were covered
by side-panel buttons. Each ChatView rendered WorkspaceTitlebarControls using a
fixed window-level position, while PaneHeaderControls occupied the trailing edge
of its own header. Multiple panes therefore shared the same floating hit area.

Pane views now place panel toggles in normal header flow after the move/close
buttons while the right panel is closed. With a panel open, its toolbar anchors
to that pane, and the thread-details toggle participates in the chat header's
flow. Single-view window controls retain their existing fixed positioning. The
top-right pane retains native window-caption clearance. Pane controls explicitly
opt out of Electron titlebar dragging.

Regression coverage uses the real toolbar/action components in Chromium with
six panes and both open/closed panels. It checks center-point hit testing for
every move and close button, geometry bounds, no-drag styling and a real close
click on the top-right pane. Exact source tests also verify ChatView wiring.
Actual packaged Mac UI testing remains separate; public 0.4.2 is unchanged.

Validation: seven focused source/wiring checks, full actual web and desktop
TypeScript, and both Chromium geometry cases passed on the combined notification
and pane source. All six panes' move/close centers hit their own buttons with
panels open and closed; the top-right close click reached its intended handler.
The same required CI browser step now includes these cases. Evidence lives at
REL/imported-task-notifications-validation. Local test/build processes completed.
This branch is stacked on fix/imported-task-notifications to keep their registry
and guide updates together; merge the notification PR first, then retarget this
PR to stage and verify its current checks/base. Do not squash into a feature branch
and mistake that for stage integration.

The parent CI correction pins the browser job to Ubuntu 24.04 for the frozen
Playwright 1.60 graph. This child separately pins its complete 346-record desktop
registry (f68b16b2…) in the native-keychain QA recipe. All 337 baseline records and
the parent's four notification records are unchanged; the five pane additions
authenticate and leave every QA identity target untouched. The seven source
predecessors still match the prepared actual source; no identity fixture or
service build freeze changed. Review evidence:
REL/imported-task-notifications-validation/ci-registry-review-pane-toolbar-placement.json.
The corrected recipe plus all managed desktop/cloud Node suites pass on this
combined branch: 104 tests, zero failures or skips. CI must validate the corrected
Linux browser installation before either UI PR merges.
