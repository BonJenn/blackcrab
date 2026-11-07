# Native Codex fixture verification

Run `node scripts/native-codex-qa.mjs` on macOS with the repository dependencies,
Rust toolchain and Python 3 installed. The runner builds an unsigned debug
`Blackcrab QA.app` with a fresh bundle identifier and app-data directory. It
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
