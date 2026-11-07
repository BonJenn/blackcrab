# Native Codex fixture verification

Run `node scripts/native-codex-qa.mjs` on macOS with the repository dependencies,
Rust toolchain and Python 3 installed. The runner builds an unsigned debug
`Blackcrab QA.app` with a fresh bundle identifier, copied bundle path and app-data directory. It
prints a manifest containing the project, receipt database, fixture state, logs
and owned process ID. Open that exact bundle when using native automation.

The app's child environment puts a local `codex` wrapper first on PATH. The wrapper
runs `src-tauri/tests/fixtures/codex_ui.py`; it does not invoke the installed
Codex CLI, read credentials, execute tools or call a provider. Model catalog,
history and turns all come from the fixture. The normal Claude sidebar can
still read local Claude history; this is not an isolated operating-system user.
Do not send messages through the Claude composer during this test.

The frontend is built with Vite development mode to suppress product analytics.
The runner refuses to launch if the product-events endpoint remains in its JS
assets. It rebuilds `dist` and the debug bundle; `npm run build` restores normal
production frontend output. Production app data and installed CLIs are unchanged.
Close the app or interrupt the runner to stop its owned process. QA artifacts
are retained at the manifest paths for inspection.

## Repeatable scenario

1. Open **Codex → Conversation**, enter the manifest's project directory, keep
   **Read only**, and start the session.
2. Send `complete`. Expect `succeeded` and `Native QA fixture reply`.
3. Send `hold`. Expect running/streaming state. Queue another message and edit
   it. Interrupt the active turn. Expect `interrupted` and a paused queue. The
   edited follow-up must run only after **Resume queue**.
4. Send `approval`, choose **Decline**, and verify the request disappears and
   queued work stays held. The fixture reports provider completion, so the
   receipt is `succeeded` with denial detail; denial is not synthesized into a
   provider failure. Repeat `approval` with **Allow once**.
5. Enter an unsent draft, close and reopen the panel. Verify the live session,
   transcript and draft remain. Stop the session explicitly.
6. In **History**, refresh, select the fixture thread, enable full legacy items,
   and expand an assistant item. Use **Continue in conversation**, then explicitly
   resume the same thread; preparing history alone must not start it.

Inspect `fixture/wire.jsonl` and SQLite `turns` in the manifest's journal. Each
`input-recorded` row must show `statusBeforeInput: dispatching`, with one provider
input per command ID. Approval decisions must appear once each. The native Rust
regression runs this same fixture through the real runtime and journal, checking
completion, interruption, held work after denial and persisted history.

## Evidence recorded 2026-11-07

The packaged native app was operated through macOS accessibility automation.
All six scenarios above reached the expected UI state. Five turns reached the
fixture: initial completion, held/interrupted turn, edited queued follow-up,
declined approval and accepted approval. All five had committed dispatching
receipts before provider input. The journal contained four successful terminals
(including the denial detail) and one interrupted terminal. Exactly one decline
and one accept were recorded; no fixture errors occurred. The stopped thread's
five turns and stored reply were visible in History; explicit resume preserved
the provider thread identity and unsent draft.

This is native UI → Tauri → runtime → SQLite → local CLI → UI evidence. It does
not establish real-provider compatibility, paid model execution, production
signing, multi-window ownership or general grid integration. Codex discovery
continues to advertise `clientReady: false` while those gates remain open.

## Multi-conversation workspace evidence, 2026-11-07

The dedicated Codex preview now supports six independently owned panes in single
or grid view. Use **Add conversation** to prepare another owner without starting
it. Select the intended conversation before continuing a thread from History.
Each pane has independent drafts, permissions, run/turn controls, queues and
approvals; the model catalog is shared. Closing the dialog or changing views
keeps owners alive. Pane selection and view mode are saved per window.

A second native fixture run verified two simultaneous provider threads, with a
different thread ID in each pane. The first pane's unsent draft remained intact
while the second requested approval. Switching to the first pane showed the
second pane's approval badge, and grid view displayed both panes side by side.
Allow once produced one successful receipt in the second thread and one accept
at the fixture, with a committed dispatching receipt before input. There were no
fixture errors. Stopping the second run left removal disabled while its draft
remained.

After explicitly stopping both sessions, restarting the same isolated app
restored both drafts, pane identities, the selected second pane and single view.
Both owners remained idle, with read-only permissions and explicit resume
controls. The second pane required resume/queue review before removal. After
explicit resume, stop and clearing its disposable draft, removal succeeded and
the first draft remained intact. Both fixture history files remained on disk.
The fixture recorded two initial starts, one explicit resume and one model
catalog request per app load; pane switching and grid view added no starts,
inputs or catalog requests.

The first attempt reused the build output's bundle path, which native automation
resolved to an older cached app identity. Copying the bundle into the unique QA
directory fixed attachment; the launcher now performs that copy. The native
scenarios above ran from that unique path.

Capacity, corrupt-layout preservation, failed-storage rollback, pending-send and
held-queue removal guards, owner disposal, legacy owner/key compatibility, and
history-to-selected-owner routing have automated regression coverage. Native
evidence covers two panes in one window; six concurrent provider processes,
multiple windows, mixed Claude/Codex grids and real model turns remain open gates.

## Main provider view evidence, 2026-11-07

Select **Provider → Codex preview** in the main toolbar. Codex uses the desktop
area with its history, account, model catalog and conversation panes. Switching
back to **Claude Code** preserves both provider views and their unsent drafts.
The selected provider is restored on app restart; selection itself does not
start, stop or replay a provider turn.

Native accessibility automation verified the full-width workspace, independent
unsent Claude and Codex drafts, and the inactive Claude sidebar disappearing from
the accessibility tree. Cmd+K did not open Claude's palette while Codex was active.
Cmd+Enter sent the fixture's `hold` message through the Codex composer. Switching
to Claude showed its original draft and a **Codex · running** badge. Returning
through that badge preserved the same provider thread, streaming turn and Codex
draft. Explicit interrupt and stop produced one interrupted receipt.

After restarting the isolated app, the Codex provider view was restored, and
opening Conversation showed its saved draft and an idle owner requiring explicit
resume. The fixture recorded one start, one input with an existing dispatching
receipt, zero resumes and no fixture errors. View switches and restart produced
no additional provider input. No Claude message or real model turn was sent.

App-level DOM regression scenarios additionally cover provider-scoped shortcuts
and file drops, retained mounted views/drafts, forced Claude setup remaining
unresolved when returning from Codex, and delayed first mounting of saved Claude
grid owners while Codex is selected. Once visited, the Claude grid keeps its
original `startEnabled` value and stays mounted on provider switches; toggling
that flag would run the existing panel's stop cleanup. Native file dropping and
live Claude grid processes were not exercised by this fixture run.

General readiness remains gated on mixed-provider grid/window scenarios and
actual provider turns. This desktop provider switch does not change mobile
provider support or advertise general Codex `clientReady`.

## Versioned pane ownership evidence, 2026-11-07

The isolated native app added a new extra pane using the versioned identity
scheme and displayed two panes in grid view. Clicking the first pane's project
field selected Conversation 1; clicking into the second selected Conversation 2.
Keyboard Tab traversal from the first pane to the second pane's Stop button
selected the second owner as well.

The new pane started a read-only local fixture session and completed a message
through the native guard/runtime/receipt path. The UI showed a successful reply;
SQLite recorded one successful receipt, the fixture observed `dispatching`
before its one input, and no fixture errors occurred. The run and owned QA app
were explicitly stopped. No real model calls were made.

Automated tests additionally cover preserved legacy addresses/draft/outbox data,
refusing ambiguous legacy primary labels, window-scoped caches and captured
factories, disjoint addresses for new panes, focus/history routing and unchanged
selection without storage writes. Native evidence is one-window only; true
multi-window process recovery and migration of ambiguous old identities remain
unverified.

## Retained conversation recovery evidence, 2026-11-07

The isolated native app prepared an extra pane, saved its fixture project path,
removed it and reopened it from **Retained conversations**. The original project
path returned and the pane remained idle. After removing it again and restarting
the same isolated app, the retained entry was still discoverable under the same
pane ID. Reopening restored the same project path and idle state without an
unsolicited start or send. The fixture wire log contained only two thread-list
and two model-list queries across both app launches, with no starts, resumes,
inputs or fixture errors. The owned app was closed after verification.

This verifies native one-window remove/reopen/restart behavior. Controller/DOM
regressions cover malformed retained lists, save/construction failure rollback,
bounded retention without eviction, stale inspection callbacks and stale history
requests. Earlier removals were not indexed, and cross-window migration and real
provider operation remain unverified. The final UI text was simplified after the
native bundle was built; the recovery behavior was unchanged.
