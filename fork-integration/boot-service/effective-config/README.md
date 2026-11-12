# Original-Effect effective configuration candidate

Purpose: desktop embedded primary only; **not independent background-service configuration**.
See SERVICE-PURPOSE-AUDIT.md before any NativeServiceFactory wiring.

Candidate only. No Root registration, native issuer implementation, active
producer registry, GUI exposure gate, service child, listener or route is changed.
Upstream: BonJenn/t3code `7f02de2eb8e253e0ec23f005b3cfff8e2c963be8`, archive
`eab8b879f121a8f917a654f9eb2d145295152082a700095fbb6c1024c0db83b6`.

## Fixed private contract for NativeIssuerCore

The native issuer must first select and fully verify the actual new artifact,
its complete profile records and entry executable, retain the native owner lease,
and capture its own child. Invoke that **selected entry**, with the sole argument
`__blackcrab-effective-config-v1`. FD3 is a newly captured, bounded private input
pipe, not a borrowed service IPC channel. Native writes and closes one <=16KiB
JSON document with exactly `{schema:1, ownerRoot, port}`. Both root and persistent
port come from the native installation binding, never renderer input. No executable,
state/settings/profile path, digest, environment ID, remote URL or scope is accepted.
Use sanitized environment/private cwd/HOME; no owner secret is needed or sent.

One success line, <=4096 bytes, has exactly six keys:

```
{schema:1,host:"127.0.0.1"|"0.0.0.0",port:1..65535,
 tailscaleServeEnabled:boolean,tailscaleServePort:1..65535,environmentId:string}
```

`port` must equal the native request. Environment identity is the original existing
trimmed nonempty value, additionally bounded to 128 UTF-16 units with no control
characters; upstream EnvironmentId is not inherently a UUID. Native may refuse an
unsupported legacy value, but must not rewrite it. Missing/empty ID, disabled local
environment, invalid input, or failure returns exit78, empty stdout and a fixed
bounded stderr message. No default/fallback JSON is authority. The parent must
bound the whole child lifetime (15 seconds is the developer probe's bound), require
successful exit and exactly one typed packet, match its bound environment identity,
and mint an opaque result only from that actual captured selected child. Arbitrary
JSON, this developer probe's path/hash, or a self-consistent unselected artifact
cannot mint native authority. No native source implementation is supplied here.

## Exact path and original-service behavior

Actual `ManagedBootstrap.mjs` sets `T3CODE_HOME=descriptor.profile.root`; Rust
`desktop_profile_root()` is `ownerRoot/native-desktop-profile-v1`. Consequently the
resolver gives original DesktopEnvironment that profile root, and its original
DesktopStatePaths derives **profile/userdata/desktop-settings.json**. Its HOME
input is the same profile's `home`. This is deliberately different from the server:
original `ServerConfig.deriveServerPaths(ownerRoot/host, undefined, explicit)` derives
**ownerRoot/host/userdata/environment-id**. Both roots remain native-derived.

Original DesktopAppSettings.load reads/normalizes its original schema. Missing,
unreadable or malformed settings intentionally yield original defaults without a
repair write. Original DesktopManagedPolicy reads the owned identity-patched
machine policy once; original DesktopServerExposure clamps remote exposure and
Serve off when policy forbids remote clients or policy reading fails. The resolver
calls only `configureFromSettings` and `backendConfig`. It reads network interfaces
but does not request advertised/Tailscale endpoints; the original lazy Tailscale
status cache is not looked up. macOS policy may run the original fixed `/usr/bin/plutil`
conversion when a managed preferences file exists. No listener, Serve route, model,
cloud, account/keychain or server descriptor/secret store is constructed.

The original ServerEnvironment identity layer would initialize a missing/empty ID
using UUID generation, scoped temp files, hardlinks and recovery rename. This
candidate **does not invoke that layer**. Its exact existing-reader branch and
persistence error class are extracted into ServerEnvironmentIdentityRead.ts;
ServerEnvironment imports that primitive and re-exports the same error API, while
its original create/recovery algorithm remains intact. The resolver imports only
the read primitive and original pure path derivation. A write-denying filesystem
service protects the resolution graph. Missing/empty state fails unchanged; first
initialization/migration requires a separate explicitly exclusive original-source
operation, not Rust settings/identity synthesis or a second writer.

## Active GUI audit: desired versus effective

Current managed desktop **does not persist LAN/Serve changes through the IPC
handlers**: the active `owner-exposure-control-gate.patch` returns Effect.die before
both original setters and relaunch. This gate must remain until native owner apply
and readiness/status publication are integrated.

In pristine upstream, IPC → DesktopServerExposure.setMode/setTailscale → settings
persistence/state update → DesktopLifecycle.relaunch. If the gate were removed
without more work, ManagedAttached's replacement configuration is static from the
owner descriptor, and its pool stops/starts attachment rather than the independent
host. A GUI relaunch alone therefore cannot apply new exposure to that owner. This
resolver is preparation for a future owner-controlled service epoch, not present
GUI effective-exposure parity. Native must apply its opaque configuration at the
captured service-child boundary and publish effective status only after authenticated
readiness. Admin policy can change later; this snapshot is not continuous attestation.

## Source/payload/staging delta

`registry.json` describes two exact candidate patches and three added-source pins:

* original ServerEnvironment reader/error extraction, keeping initialization behavior;
* private dispatch in original server bin before full CLI/launcher parsing;
* EffectiveConfigRuntime.ts, EffectiveConfigCli.ts and the extracted reader.

Promote **all five additional records together**, in addition to the five existing
owned boot-service/profile4 records and applicable identity/host records. Baseline5,
original3, existing C21 and an artifact without the new records must not authorize
this command. Do not silently insert it into an old profile. The dispatcher imports
the adapter graph directly; the normal CLI raw-asset loader is not entered. A fresh
producer must stage these exact files from authenticated complete source, bundle
that graph into the selected entry, emit new full payload inventories/digests and
exercise the actual packaged private command. No arbitrary CLI payload addition,
release feed, download, install or production registration is performed here.

## Evidence and limits

`prepare-probe.mjs` is developer preparation only: it checks pinned source records,
uses read-only frozen dependencies, stages exact original/candidate code and checks
one physical Effect4.1.2 identity. It does not authenticate a new archive or mint
native authority. Actual captured private subprocess integration uses that bundled
original Effect graph with real private filesystem settings and existing identity.
Global mutation/listener/network guards and before/after owner-state hashes detect
writes or unexpected effects. Defaults, dual roots/ambient override isolation,
corrupt defaults, disabled local mode, missing/empty ID and Serve normalization pass.
No listener/route/service/model/provider is started. Focused original-graph strict
TypeScript no-emit validation passes. This is not a packaged profile4/SEA acceptance,
full monorepo build, service installation or current GUI apply acceptance.
