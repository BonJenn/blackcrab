# Upgrading an installed background service

Until 0.4.5 a launcher could only attach to the service runtime it was built
with. The runtime's manifest digest is compiled into the launcher and its
helper, and the installed configuration, helper binding and OS registration all
name it, so a launcher carrying a different runtime refused the installed
service ("Background service issuer is unavailable"). Every release from 0.4.0
to 0.4.4 therefore shipped the same Apple-silicon runtime, `c04c4d44…`.

0.4.5 changes the runtime (paired models, IDE saving, the Windows browser
channel), so the launcher now replaces an installed runtime itself.

## What happens

On start the launcher asks for the service status as before. If the installed
runtime is one an earlier release installed, the status is `upgradeRequired`
and the launcher performs `upgrade` without asking:

1. **Stop and unregister.** The existing Uninstall action, built from the
   installed configuration: it stops the service, waits for the OS and the
   helper's own record to confirm it stopped, and removes the launchd unit,
   systemd unit or scheduled task. Agents that are working are stopped.
2. **Copy the database.** `statev2.sqlite` with its `-wal` and `-shm`,
   `settings.json` and `keybindings.json` are copied to
   `host/upgrade-backups/<first 16 digits of the old manifest>/`. Nothing reads
   this copy back; it is there for a person to recover from.
3. **Replace the runtime.** The bundled runtime is staged, verified and
   version-checked beside the installed one. The installed version directory is
   then moved, whole, to `host/runtime/retired/<old manifest>/` and the new one
   takes its place. If the new one cannot be published the old one is put back.
4. **Rewrite the configuration and binding.** The configuration names the new
   manifest; its path, secret, environment id and browser capability are
   unchanged. This build's helper is installed and bound with the same
   generation and environment id.
5. **Register and start** through the ordinary Install action.

`host/userdata` is never moved or rewritten: conversations, settings,
credentials, pairings and the environment identity stay where they are.

## What is accepted

Only the manifests listed in `PREDECESSORS` in
`src-tauri/src/managed_service_issuer.rs`, per platform:

| Platform | Release | Manifest |
|---|---|---|
| Apple silicon | 0.4.0–0.4.4 | `c04c4d4498a552d3c1ca26c2d600ddde7ed513c8c6030d5f7ce79ece15f45e83` |
| Linux x64 | 0.4.4 | `491d73ac66be7a27338adace318d7dd41f3c107b5e4ec3be68b7e1de7a791775` |
| Windows x64 | 0.4.4 | `54e12d14ab2455530dbce83c3028940595eed637181514264059087610097648` |
| Apple silicon | 0.4.5 | `eda8408d56339d98d5e6905b417295add611f0afca1af73bb1da60cf5cbb2160` |
| Linux x64 | 0.4.5 | `3819159dd522d732303965ca5d81679d274e4a7393d8d248bd00388ec5e1baa9` |
| Windows x64 | 0.4.5 | `608b24056ac3f118a881b35e99a484925a5d962bb4bfd9cd1f30d26d76bae495` |

Service builds are not byte-reproducible: the same source gives a different
manifest on every build. So every release has new digests, and the digests of
a release must be added here, from its own build records, before the next
release is built. A launcher that already carries the installed runtime's
digest as its own does nothing.

A predecessor is accepted only for stopping, unregistering and confirming
stopped. It is never attached to, started or issued credentials, and Start,
Restart and Install are refused while one is installed. A runtime that is
neither this build's nor a listed predecessor is refused exactly as before.
**Every release that changes the runtime must add the runtime it replaces to
this list**, or its users cannot upgrade.

## Interruption

Each step is skipped if an earlier attempt completed it, and the status stays
`upgradeRequired` until the configuration, binding and installed layout all
name the new runtime, so reopening Blackcrab finishes an interrupted upgrade.
The one window with no installed runtime is between the two renames in step 3;
the next attempt finds the retired directory and publishes without retiring
again.

## The service's search path (0.4.6)

On a Mac the launchd unit carries a fixed `PATH`, written when the service is
registered: the launcher's own search path plus a few standard folders. The
launcher's path comes from a login shell, which does not read `~/.zshrc`, so a
folder added only there is missing. 0.4.5's upgrade removes and re-creates the
unit, so it rebuilt that list and could drop folders an earlier registration
had; and `~/.local/bin`, where Claude's own installer puts `claude`, was never
on it. The owner hit this on the first Mac upgraded: "Claude Agent CLI was not
found on PATH".

From 0.4.6 the Mac unit always includes `~/.local/bin`, and removing a unit
saves its `PATH` to `service-search-path` in the owner directory, which the
next registration appends. A service already upgraded by 0.4.5 gets
`~/.local/bin` when 0.4.6 re-registers it; folders 0.4.5 dropped are not
recoverable. The service reads its search path once at start, so a tool
installed later in a folder not on the list needs a link in a listed folder
(`/opt/homebrew/bin`, `/usr/local/bin`) or a re-registration.

## Not supported

- Going back. A 0.4.4 launcher refuses a service upgraded by 0.4.5. To go back
  by hand: stop the service, move `retired/<old manifest>` back to
  `versions/0.1.7`, and restore `configuration.json`'s `manifestDigest` and the
  old binding. The database copy covers a runtime that changed the database;
  0.4.5's does not.
- Cleaning up. Retired runtimes (about 350 MB each) and database copies are
  never deleted.
- Direct (non-service) workspaces. They are not migrated.

## Evidence

Unit tests cover phase detection for every interruption point, the retire and
publish transaction, refusal of an active session or unknown runtime, and the
database copy. The Linux and Windows installed-acceptance jobs install the
published 0.4.4 package, open it once, install the candidate over it, and check
that the manifest changed while the generation, secret, environment id and
database stayed, the old runtime was kept and the database was copied. There is
no such automated check on a Mac.
