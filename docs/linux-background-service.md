# Linux background service

The native launcher controls `blackcrab.service` in the current OS account's
systemd user manager. The executable and environment come from the existing
verified service configuration and native issuer binding. The renderer supplies
only the lifecycle action. Existing direct-start configurations are not migrated.

Install publishes a private unit and its exact `default.target.wants` link, reloads
the user manager, verifies the effective configuration and starts the service.
Start also enables the owned login link. Stop waits for systemd and the native
issuer journal to confirm shutdown; the login link remains. Restart performs that
same stop before starting again. Uninstall removes only the verified unit and
link, retaining runtime, journal, environment ID, host data, history and pairings.
Closing the desktop does not stop this independent service. Linux desktop login
is required; Blackcrab does not enable system-wide services or linger.

The launcher obtains HOME from the OS account and connects only to that uid's
verified `/run/user/<uid>/bus`. It executes fixed `/usr/bin/systemctl` and
`/usr/bin/busctl` paths with cleared environments, bounded output and deadlines.
A timeout reaps only the captured manager child. It does not imply that an
asynchronous manager job was undone; a pending job blocks further mutation until
status can be established. The next request checks the native journal again.

The unit is published without replacing an existing file. Wrong owners, links,
loose modes, foreign wanted links, changed owner/runtime fields, manager drop-ins,
pending jobs and mismatched loaded argv/environment are rejected. The original
installed PATH is retained when the desktop is reopened with a different PATH.
Unit files contain public selection metadata, never bootstrap credentials.
Systemd field parsing follows its [unit parser](https://github.com/systemd/systemd/blob/v255/src/core/load-fragment.c):
command words are quoted, while WorkingDirectory and append-log paths are literal
paths with escaped percent specifiers. The executable path is not subject to
environment-variable expansion. Typed bus properties avoid parsing formatted argv.
See [systemctl](https://www.freedesktop.org/software/systemd/man/latest/systemctl.html)
and [busctl](https://www.freedesktop.org/software/systemd/man/latest/busctl.html).

## Verification and remaining delivery

The local actual Rust crate's managed regression suite passed181 tests, with10
explicitly ignored artifact/native scenarios. The Linux controller is also compiled
under Mac tests, covering unit files, foreign/changed manager properties, absent
units, PATH retention, serialization and bounded child timeout/output behavior.

`scripts/test-linux-service-manager.py` is restricted to disposable GitHub Linux
runners. It creates a new uid1999 OS account and user manager, executes the compiled
ignored `actual_systemd_user_lifecycle` test, then stops/removes only that account.
The test uses an inert launcher in a path containing spaces, percent and dollar
characters. It verifies actual manager configuration, start/reopen without a second
start, stop/start, restart, removal and history retention. It invokes no provider.
This CI result is pending until the PR checks complete; do not count the test's
presence or an ignored default run as passing native acceptance.

Linux host payload production, bundled issuer/Root initialization, real workspace
launch and installers still need integration and acceptance. Windows IPC/ACLs and
service integration also remain. Mac0.4.3 and Windows/Linux0.3.0 remain the published
downloads. This source change does not publish0.4.4 or change the Mac service payload.
