# Blackcrab Remote — mobile guide

Keep this file and CLAUDE.md identical. Read the repository root guide first.
Current status and release blockers are in ../../docs/agent-handoff.md.

## Product and ownership

This is the existing remote app, not a new replacement application. Preserve
its legacy Hosts/Chats/Providers views, saved pairings, offline drafts and queues
while the complete pinned mobile interface supplies managed workspaces.
`index.ts`, the root-shell integration, generated native UI and activation
adapters must share the intended runtime/registry and app-lifetime owners.
Navigation, remounts or switching experiences must not create a second queue
owner, replay a send, or clear a newer draft.

Use the authoritative host's commands, permissions and receipts for agent
control, source control, approvals, scheduling and orchestration. Keep provider
credentials on the host. Scope all state and callbacks to host/session/generation.
An unknown send outcome requires explicit recovery with the original command ID.
Native SecureStore failures must remain visible and preserve stored bytes.
Do not silently replace corrupt storage with empty collections or memory storage.

## Source and native build

The app uses Expo 58.0.14 / RN 0.88.0 / React 19.3.0, not the older SDK54
scaffolding described in historical documents. Root React remains 19.1.
`vendor/t3-mobile` is pinned; edit activation/config adapters and recorded patches
rather than the preserved upstream source or `.generated` files.
Use `../../scripts/prepare-mobile-ios.mjs` and the native build guide.
Native staging must be physical, whitespace-free and outside the source tree.
Retain original SecureStore identity/app groups during upgrades; uninstalling
between baseline and upgrade invalidates retention acceptance.

## Distribution

Owned bundle ID: `dev.blackcrab.remote`; share and widget extensions have their
own suffixes and use `group.dev.blackcrab.remote`. Verify all targets' profiles.
Register and link that group to all three identifiers; enabling the App Groups
capability alone is insufficient. Reject exports that drop generated entitlements.
Public cloud inputs use BLACKCRAB_* configuration; secret keys never belong
in the JS bundle. Owned Expo project/channel configuration is explicit.
The iOS helper supports simulator Release builds and explicit device archive /
App Store IPA export with private signing inputs. Simulator products cannot be
submitted to TestFlight. Upload, Apple processing and tester availability are
separate from archive/export success. The existing Expo project and App Store
Connect app were verified on 2026-11-12; production EAS submission targets them.

## Verification

Use scoped mobile typechecks/tests and the relevant managed-validation configs.
Native acceptance must record the exact app/host source and artifact hashes.
Test retained storage, cold/foreground reconnect, revocation, switching hosts,
queue recovery and keyboard behavior. Broader agent/workspace actions, genuine
off-LAN access, APNs, physical-device behavior and TestFlight are still separate
gates; older simulator proofs must not be relabeled as a current release pass.
