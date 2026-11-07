# Pinned T3 backend feasibility probe

This experiment runs the target backend in a fresh, private data directory on
loopback. It never uses `~/.t3/userdata`, installs a service, starts an agent turn,
or opens a browser. It is a comparison artifact, not Blackcrab host integration.

Use the reference source at BonJenn/t3code
`7f02de2eb8e253e0ec23f005b3cfff8e2c963be8`. The reference archive used here had
SHA-256 `eab8b879f121a8f917a654f9eb2d145295152082a700095fbb6c1024c0db83b6`.
Keep the source/dependencies on a volume with sufficient space. Its package
manifest pins Node 26.12.1 and pnpm 12.14.0; this probe verifies the Node version.

Install those tools in an isolated prefix, then from the reference source run:

```sh
pnpm --filter t3... install --frozen-lockfile --ignore-scripts --store-dir /path/to/isolated-pnpm-store
pnpm --filter t3 build:bundle
```

Ensure the chosen Node/pnpm executables are first on PATH for those commands.
The recorded installation used the pinned lockfile, skipped lifecycle scripts,
and resolved 974 packages. No source edits or shared package-manager settings
were needed. Installation count includes development/build dependencies and is
not a shipped-runtime dependency count.

From Blackcrab, run each entry point:

```sh
node experiments/t3-backend-prototype/probe.mjs --source /path/to/reference --node /path/to/node26
node experiments/t3-backend-prototype/probe.mjs --source /path/to/reference --node /path/to/node26 --bundled
```

An optional `--output /existing/directory` puts private temporary artifacts on a
chosen volume. Each run starts and stops only its captured server subprocesses.
It verifies the public environment descriptor, unauthenticated project rejection,
a project created by a separate CLI client, stable environment identity after
server restart, and a second client's rename of the persisted project. Neither
client exiting may terminate the host. No agent commands or provider turns run.

Ambient T3/Vite/OTel configuration is removed from the child environment. Runtime
state is an explicit generated `--base-dir`; automatic browser opening and data
seeding are disabled. Logs stay in the private artifact directory with mode 0600.
They can contain this sandbox server's generated pairing credentials and are
never committed or printed by the report. The report includes only the stage,
assertion outcome, toolchain and artifact paths.

## Recorded evidence (macOS arm64, 2026-11-07)

Both source and bundled entries passed two server starts each, separate project add/rename clients,
stable environment identity and HTTP 401 for unpaired project access. The server
bundle built without source changes: 55 files, 59,931,544 bytes including source
maps; 19,018,499 bytes excluding maps. The pinned Node executable was 147,346,352
bytes. These numbers exclude runtime externals, web assets, native helpers,
provider CLIs, voice/browser assets, signing and update metadata; they are not a
complete shipping-bundle size.

The source/bundle runs resolve native/runtime externals from the reference
workspace installation. They do not prove a relocated standalone distribution,
Blackcrab desktop integration, its mobile protocol compatibility, provider turns,
Windows/Linux packaging or production service supervision. See the
[architecture decision](../../docs/independent-host-architecture.md).
