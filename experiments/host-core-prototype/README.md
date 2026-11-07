# Host-core extraction feasibility probe

This Unix-only experiment reuses Blackcrab's existing execution store, JSONL
transport and runtime in a separate process with no Tauri dependencies. It is a
comparison artifact for the independent-host architecture decision, **not a
supported headless host, remote API, service installer or production migration**.
Only the local Python fixture runs; no provider credentials or real model are used.

From the repository root, with Rust and Python 3.11+:

```sh
cargo build --locked --manifest-path experiments/host-core-prototype/Cargo.toml
python3 experiments/host-core-prototype/smoke.py
```

For the optimized stripped binary:

```sh
cargo build --release --locked --manifest-path experiments/host-core-prototype/Cargo.toml
python3 experiments/host-core-prototype/smoke.py --binary experiments/host-core-prototype/target/release/blackcrab-host-core-prototype
```

The smoke creates a fresh mode-0700 temporary directory, starts the Rust host and
its existing `src-tauri/tests/fixtures/codex_ui.py` child, and opens distinct Unix
socket client connections. It submits a held turn, disconnects the client, then
reconnects and reads the identical running receipt. A second host process opens
the same journal, confirms that the live owner's receipt remains running, and
fails to acquire that same provider session's ownership lock. An explicit
interrupt produces one interrupted terminal receipt. Stop reaps the owned fixture
process and removes the control socket. The fixture log must contain exactly one
provider input, with its durable `dispatching` receipt already committed, and no
fixture errors. The report includes artifact paths and measured binary size.

Artifacts stay in that test directory for inspection. Failure cleanup terminates
only the process group created by this smoke. There are no production app-data
defaults, network listeners, service installation or automatic message replay.
The socket directory must already be private and carry the smoke runner’s
experiment marker; unmarked directories are rejected before opening a journal.
Another socket is never replaced.
The simple probe protocol has no remote authentication/grants and must not be
adapted into a network listener without implementing those boundaries.

## Reuse and limits

`main.rs` imports the real modules by path. Three relative source symlinks under
`src/reused` preserve Rust's nested-module resolution for `execution.rs`; they
contain no copied runtime source. The crate pins the six direct dependency
versions already used by the desktop lockfile. The fixture executable path is
explicit, and its QA variables are passed only in that subprocess's environment.

The experiment intentionally disables the binary's `cargo test` harness: imported
module unit tests belong to the native crate and expect its fixture directory.
Run those through the repository's regular smoke command; this experiment's
process/client/ownership scenario is `smoke.py`.

A journal is **not globally exclusive**. Separate host handles may open it, but a
live per-host lease prevents a new handle from recovering that owner's active
turns, and a provider-session lock prevents two runtimes owning the same native
thread. The smoke tests those actual guarantees rather than asserting a blanket
journal lock.

The runtime here is the existing local fixture path. This does not extract the
Tauri-dependent host/controller/event services, the Claude process manager,
remote pairing/authentication/relay, client reconnection subscriptions, durable
host session supervision, startup/update packaging or Windows support. Those
remain required production work. Success proves that the existing store/runtime
can form a small independent process without copying T3's backend; it does not
establish full independent-host parity.

## Recorded result (macOS arm64, 2026-11-07)

The debug and stripped release process smokes passed. The final release smoke
verified unmarked-root rejection before journal creation, disconnected-client
survival, reconnect receipt identity, second-host live-receipt preservation and
provider-session exclusion, one fixture input, an interrupted terminal receipt,
provider reaping and socket removal. Cargo.lock contains no Tauri packages;
`otool -L` reported only `libiconv` and `libSystem` dynamic dependencies.

| Build | Measured binary bytes |
|---|---:|
| Debug without debug symbols | 9,829,472 |
| Optimized, stripped release | 3,599,392 |

These are this probe's executable sizes, not a full distributed host bundle.
Provider CLIs, service supervision, authenticated transports, Claude integration
and client subscriptions are outside that measurement.
