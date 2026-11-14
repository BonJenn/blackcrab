# IDE mode — 0.4.5 draft

This is an opt-in source experiment against BonJenn/t3code
`7f02de2eb8e253e0ec23f005b3cfff8e2c963be8`, after the current managed desktop
patch chain. Original upstream MIT notices and licenses remain intact.
`registry.json` authenticates every predecessor, replacement, diff and payload.
The production desktop/host registries, service freeze and manifest are unchanged.
This recipe is deliberately not imported by a release producer. Do not merge or
publish it as part of 0.4.4. Integrate its host and renderer records together only
after coordinating the stopped, data-preserving host migration for 0.4.5.

Prepare a fresh disposable source with `prepareIdeSource({archive,cacheDir})` from
`prepare.mjs`. It first authenticates the pinned archive and applies production
desktop patches, then applies the experimental registry. Reuse dependencies only
through `linkDependencyCache` with an identical frozen upstream lockfile. Set
`VITE_BLACKCRAB_IDE_MODE=1` when building/running that prepared web renderer. Chat
remains the initial mode; without that flag the toggle is absent. Run the prepared
server against fresh QA data, never the installed service's database/profile.
The returned provenance explicitly says `releaseEligible:false`.

The current host still works as a read-only IDE source. An opt-in file read asks
for `ideSafeWrite`; only the changed host responds with that capability. IDE will
not send a write unless the capability and existing filesystem-write scope are
both present. Existing read callers and ordinary writes keep their contract.

## Behavior

- The large code-first panel slides in beside the existing chat and composer.
  It reuses the pinned file tree, virtualized Pierre editor, syntax highlighting,
  current theme and composer review-comment context.
- Structured host file-change events select paths inside the thread's actual
  worktree/environment. Agent changes show operation/status. Command text, tool
  arguments, `newStr` and diffs are never fabricated into file contents.
- Host reads refresh the selected file after mutation events and every second
  while visible. Writes appear as disk snapshots, not token-by-token animation.
  Changes to paths a provider does not report cannot automatically select those
  paths. The tree remains available for manual browsing.
- Manual browsing/editing pauses follow. Resuming follow never discards a dirty
  file. Dirty drafts survive file switches, mode switches and route changes and
  are mirrored to session storage for tab reload recovery. Storage failures are
  visible; Export draft and a close warning remain available. Forced process
  termination/session-storage eviction is not a durable backup guarantee.
- Gutter/line selection plus a question attaches exact path, line range and code
  to this pane's chat draft. It does not send a message without user action.
- Save uses the original disk contents as a precondition on the authoritative
  host. External changes keep the local draft and show the incoming version;
  the user must explicitly acknowledge the new baseline before merging/saving.
  Truncated files, failed reads, old hosts and missing write permission are not
  editable. Save responses and reads are fenced against stale in-flight results.
- Successful guarded writes serialize host saves, write/fsync a temporary file,
  preserve mode bits, retain the old inode in a unique adjacent `.bak` hard link,
  recheck contents/identity and rename. Recovery files are never auto-deleted.
  Unsupported hard links fail safely. A provider retaining an old descriptor
  writes to the recovery inode instead of the replacement file.

## Validation and remaining gates

Run `node --test managed-desktop/ide-mode.test.mjs` with Node 26.12.1. In the
prepared source run the real `WorkspaceFileSystem.test.ts` and added
`IdeWorkspaceFileSystem.test.ts`; web browser tests include the mounted IDE state
suite, actual Pierre typing/snapshot test and upstream file-tree/editor tests.
Use `node ../../node_modules/@effect/tsgo/dist/effect-tsgo.cjs tsrs --noEmit`
inside each of apps/web, apps/server and apps/desktop. The browser state suite
labels its editor/RPC shims; it is not an authenticated end-to-end native test.

Before promotion: validate the full authenticated browser → host flow in a
relocated build, full ChatView pane sizing/keyboard controls on narrow windows,
real provider event timing, reconnection, native close/quit draft warnings and
Windows/Linux filesystem behavior. The filesystem cannot provide an atomic CAS
against arbitrary external processes: a process replacing the path in the tiny
interval between the last check and rename can still race the save. The backup
retains the checked inode, not every independently replaced inode. This limitation
must be resolved or constrained before claiming fully lossless concurrent saves.
No Mac installer, Windows/Linux package, native acceptance or release is claimed.

Do not feed a source manually modified with these patches to a production build
and reuse its production provenance. The release producer integration and new
source/manifest authentication are separate required work.
