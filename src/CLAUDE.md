# Native launcher renderer

Keep this file and CLAUDE.md identical. Read ../AGENTS.md and the current handoff.

The managed Electron workspace is now the sole desktop interface. The owner
explicitly removed the older Claude/Codex screens on 2026-11-12. Do not restore
them, add a legacy toggle, or require an Open full desktop action at each launch.
Root renders only automatic startup, actionable service recovery and app updates.
The shared workspace owns projects, agents, terminals and source control.

workspaceStartup.ts serializes one native startup attempt. Check package metadata
first, preserve an existing direct host, initialize only a fresh configurable
service, and install/start only an inactive service. Bounded status polling may
observe startup; never replay an uncertain mutation automatically. Native status
is authoritative even when a JavaScript runtime marker is absent.

Wait for native activation of the captured child before hiding Root: AppKit on
Mac, the private loaded/visible-window lifecycle acknowledgement on Linux. Keep recovery
visible on failure. Opening service settings during startup must wait for an
in-flight mutation to settle before exposing another action. Late completions
after cancellation cannot hide or overwrite the replacement view.

Run startup/recovery behavior tests, renderer types/build and required CI. Native
activation/reopen/quit/service survival still require actual packaged UI evidence.
User databases, histories and provider sessions are never deleted or migrated by
removing a renderer. Native code for retained data compatibility is not a UI route.
