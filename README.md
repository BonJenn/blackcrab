# Blackcrab

Blackcrab is a desktop workspace for coding agents, projects, source control,
terminals and remote access. Its managed Electron workspace is the sole desktop
interface. Opening the app prepares the background service and opens the workspace
automatically; the native launcher handles startup recovery and signed updates.

This branch prepares the next Apple-silicon Mac release. The new startup behavior
still needs signed installer and native lifecycle acceptance before publication.
See [release notes](docs/release-0.4.2.md) and the
[current delivery handoff](docs/agent-handoff.md) for verified status.

![Blackcrab logo](blackcrab_logo.png)

## Desktop experience

- Manage coding-agent threads and projects in the shared workspace.
- Work with source control, terminals, previews, approvals and queued follow-ups.
- Connect the Blackcrab Remote iOS app to a managed environment.
- Keep the independently owned background service available when the workspace
  closes; reopen the app to return to it.
- Recover startup failures and manage the background service or updates through
  the native **Blackcrab → Background Service and Updates…** menu.

The older Claude/Codex interface and its legacy remote-session server are retired.
Removing those screens does not delete existing conversations or app data. Legacy
files are not automatically imported into the new workspace by this change.

The shared client and host reuse the pinned T3 source with reviewed Blackcrab
adapters, branding and owned service configuration. Imported source and passing
builds do not establish complete parity; the [scenario ledger](docs/t3-parity-ledger.md)
tracks outstanding desktop, mobile and cloud acceptance.

## Development

Use Node 26.12.1, npm 12.2.2, Rust stable and Tauri 2 system dependencies. The
pinned shared-source producer uses pnpm 12.14.0. Do not flatten the root React 19.1
and mobile/shared-client React 19.3 dependency graphs.

```sh
npm ci
npm run typecheck
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml --locked
npm run dev
```

`npm run dev` runs the native launcher. A launcher without verified managed
payloads displays recovery; it does not contain another desktop interface.
`npm run dev:web` runs only the launcher renderer for UI development.

The full workspace is produced through `managed-desktop/build.mjs` and the
background service through the managed-host producer. Native packaging consumes
verified artifacts:

```sh
npm run build:native -- --managed-desktop /absolute/path/to/desktop-artifact \
  --managed-service-host /absolute/path/to/service-artifact
```

Read [managed desktop guidance](managed-desktop/AGENTS.md),
[native integration guidance](src-tauri/AGENTS.md) and [RELEASE.md](RELEASE.md)
before packaging. An ad-hoc local build is not a signed/notarized release.

## Downloads and updates

Download published installers from [blackcrab.app](https://www.blackcrab.app)
or [GitHub Releases](https://github.com/BonJenn/blackcrab/releases).
The root launcher retains the signed Tauri updater. Signed release builds require
the existing updater key and produce the updater artifacts and `latest.json`.
Never replace public release assets with an unvalidated candidate.

## Repository map

- `src/App.tsx`, `workspaceStartup.ts`: automatic startup, recovery and service coordination.
- `src-tauri/src/managed_launcher.rs`: activation, reopen and workspace lifecycle.
- `src-tauri/src/managed_native_entry.rs`: verified desktop/host attachment.
- `managed-desktop/`: pinned Electron source patches, branding, producer and verification.
- `managed-host/`, `fork-integration/`: independent host ownership and service integration.
- `managed-cloud/`: Blackcrab-owned remote-service and client configuration.
- `apps/mobile/`: Expo/React Native Blackcrab Remote iOS application.
- `docs/agent-handoff.md`: current source, evidence, delivery state and remaining work.
- `docs/t3-parity-plan.md`, `docs/t3-parity-ledger.md`: implementation and acceptance scope.
- `docs/hosted-service-plan.md`: free local/self-hosted use and paid hosted-service rollout.

Historical docs describing the retired panels remain implementation history, not
instructions for navigating the current application.

## Privacy and security

Local coding providers, tools and MCP servers use the credentials and access
configured for them. Remote access additionally uses the configured hosted or
self-hosted service. Official Blackcrab builds use Blackcrab-owned services;
forking the source does not grant access to hosted accounts or subscriptions.

Blackcrab coordinates powerful local development tools and is not a sandbox.
See [PRIVACY.md](PRIVACY.md), [SECURITY.md](SECURITY.md) and the hosted-service plan
for further context. Report vulnerabilities privately.

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md) and the nearest `AGENTS.md` for contributor
guidance. Blackcrab is Apache-2.0 licensed; see [LICENSE](LICENSE). Reused upstream
source and packaged dependencies retain their licenses and notices.
