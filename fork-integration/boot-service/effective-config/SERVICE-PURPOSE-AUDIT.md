# Desktop-primary resolution is not background-service resolution

This candidate's `__blackcrab-effective-config-v1` command is exclusively the
**desktop embedded primary backend** configuration snapshot. Its original
`localEnvironmentEnabled=false` failure suppresses that primary, not an independent
background service. Do not wire this candidate into NativeServiceFactory.
The current command/profile is not a general service configuration authority.

Pinned source evidence (commit recorded in registry.json):

* `apps/desktop/src/app/DesktopApp.ts:196` skips local backend startup when the
  desktop setting is false, after protocol/IPC/window initialization. Remote
  connections remain a separate frontend concern.
* `apps/server/src/cloud/bootService.ts` installs the launcher with its managed
  state root and environment. It does not consult DesktopAppSettings.
* `apps/server/src/serviceLauncher.ts:95` `readServiceEnvironment` loads
  `<baseDir>/service.env` via original `node:util.parseEnv`, preserving literal
  values and excluding PATH, T3CODE_HOME, T3_BOOT_SERVICE_UNIT and launcher-context
  overrides case-insensitively. The launcher then spawns its selected runtime with
  exactly `serve`, this merged environment and its own private launcher context.
* `apps/server/src/cli/service.ts:101` writes T3CODE_LAN=false only for a NEW
  supported service with neither LAN nor HOST already configured. Missing LAN in
  a legacy installation deliberately preserves the older managed-LAN default.
* `apps/server/src/cli/config.ts:263` `resolveServerConfig` derives server config
  from original CLI/environment/bootstrap precedence, not desktop settings.
  Its lines 422–443 preserve explicit HOST precedence and compute
  `privateNetworkOnly` from web mode, LAN and original launcher-managed mode.
  Implicit managed LAN is 0.0.0.0 WITH privateNetworkOnly; explicit 0.0.0.0 is a
  different policy result. An unspecified web host can remain undefined. Explicit
  host values can include IPv6 or a Tailnet address. Tailscale settings similarly
  come from original CLI/env/bootstrap precedence. DesktopManagedPolicy is not
  imported by this resolver or bootService: importing the desktop clamp into service
  resolution would add a new policy rather than preserve original service behavior.

The current six-field desktop packet loses `privateNetworkOnly` and cannot express
an undefined/arbitrary original host; converting every host to loopback/wildcard or
ignoring this flag is not a faithful service implementation. Environment IDs remain
original nonempty strings, not UUID-only values; no service resolver may rewrite
existing identity to satisfy a narrower native schema.

## Separate fixed-purpose proposal (not implemented or authorized)

Use a distinct selected-profile record set and private command, for example
`__blackcrab-service-effective-config-v1`; never select purpose from a renderer
argument or silently reinterpret the existing command. Native supplies only its
bound owner/state root and native persistent port over a fresh private FD. Original
service `T3CODE_HOME` is fixed to ownerRoot/host; desktop profile settings are not
read. No Local-environment preference is forced true or rewritten.

Execute original `readServiceEnvironment` against that root with sanitized inherited
environment. Preserve the original environment merge's effect on runtime config
without returning environment values (service.env can contain credentials). Native
must launch the real child from the SAME bounded verified environment snapshot or
bind a sealed snapshot internally: rereading mutable service.env later gives a
TOCTOU mismatch. Never project raw service.env or its secrets to Rust/UI/logs.
The resolver's use of a native persistent port must be explicit original CLI flag
precedence, consistently passed to the actual service child; do not silently ignore
an environment-configured port during one phase but honor it in the other.

Do not invoke full original `resolveServerConfig` as a read-only query unchanged:
it creates cwd/server/log directories, can select an automatic port, reads a
bootstrap FD, and loads observability/static-dir state. Instead make an exact
hash-recorded original-source refactor extracting the original pure network
precedence branch (including launcher-managed semantics) for BOTH normal serve
resolution and the read-only service query. Keep original parsing/Config schemas,
not a Rust translation. Resolve managed service status from the captured native
service role, not a forged environment JSON context. Preserve all current original
service tests before accepting this refactor.

A distinct bounded service packet must include purpose/schema, original existing
identity string, host as string|null (null means original unspecified), port,
privateNetworkOnly, tailscaleServeEnabled and tailscaleServePort. Validate the exact
packet against the captured selected child; do not infer LAN semantics from the
host string. Any additional native organization policy is a separately named,
audited owner policy step and must apply consistently at real child launch.

Required real-original tests: desktop local disabled + independent service still
resolves; new-install LAN=false; legacy absent LAN managed default; explicit HOST
with LAN=true; IPv6/Tailnet/undefined host; literal service.env parsing and protected
names; CLI port versus env port; Serve settings; malformed settings/env; existing
non-UUID ID unchanged; zero listener/model/route/init writes; changed service.env
between resolve/spawn rejected or same sealed snapshot used. Actual service-child
readiness must prove the projected policy is enforced, not merely a query result.

## Separate desktop UI work

Local environment disabled must still permit the full managed frontend to connect
to an independent service as an ordinary remote environment, with no desktop
primary requirement. Owner service start/stop/status and service exposure controls
need independent native owner lifecycle/apply wiring. The current exposure-control
IPC gate remains before setters/persistence/relaunch; removing it is not part of
this candidate. No active native/service factory or GUI gate is changed here.
