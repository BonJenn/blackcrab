# Reviewed service-profile build controller

Preparation and execution are separate actions. A reviewed run binds source,
tool, cache and configuration inputs before copying or compiling anything.
No service install/selection, native helper invocation, device action or provider
call is part of this controller.

Run with the pinned Node26.12.1 and a clean startup environment (`env -i PATH=...`).
The artifact's authoritative pnpm pin is12.14.0. --prepare accepts a reviewed public
path configuration, validates ownership-enabled APFS via actual diskutil
GlobalPermissionsEnabled, exact mountpoint walk and st_dev, creates only new task
folders, queries tool versions/target, verifies the archive and complete44-record
source graph/tool/producer hashes, and resolves the original monitor lock's36public
registry packages (37total lock entries). It does NOT copy/extract/install/build.

The private plan binds fresh canonical paths/nonce and all producer inputs. --run
revalidates them; any code/tool/profile change requires fresh preparation. A wx
RUN-STARTED marker prevents resume/replay, and an exclusive own build lock serializes
these producers. Stale/uncertain build locks are never cleared from PID records.

## Layout and resource budget

* Private ownership-enabled APFS: HOME/TMP/work/logs/npm cache/Cargo cache,0700dirs
  and0600raw manifests/logs. No inherited credentials or original user config.
* Fresh external public-code workspace: independent pnpm-store copy, fresh pinned
  archive source/install/targets and new quarantine output. Existing protected
  pnpm store measured about2.08GiB; anticipated external peak is approximately5–7GiB
  including source/install/build/output, with ample existing external capacity.
* Estimated private APFS peak <=1–2GiB (archive/work/TMP/public Cargo seed); actual
  low-water monitoring governs. Start requires >=4GiB BOTH internal and APFS;
  watcher cancels below2GiB on either. Heavy builds are externally serialized;
  Cargo build jobs=1. No global cache cleanup or changes to protected caches.

The build uses a private offline pnpm store and offline selective Cargo cache.
Store files are copied to independent inodes, never hardlinked/symlinked to protected
inputs. Old pnpm projects/links caches are not borrowed. Every copy verifies source
and destination bytes; public Cargo archives match original Cargo.lock checksums.
No Cargo credentials/user config is copied. Ancestor Cargo configs are refused;
private Cargo target/wrappers are fixed. Frozen offline installation must still
prove complete cache coverage; missing package data fails, never downloads silently.

pnpm12 also needs full registry metadata to enforce the original frozen-lock
supply-chain policies offline. The separate explicit preparation command fetches
complete public packuments from the fixed npm HTTPS origin without credentials,
proxies or redirects. It retains raw responses and creates pnpm's native
metadata-full envelopes. The fixed plan binds1823 package names and2072 registry
versions from both original lockfile documents. Locked integrity and publication
time are mandatory; historical versions and publisher/provenance data are retained.
Each response is bounded to64MiB with a120-second total deadline.

The controller accepts only a fully verified seed with its reviewed manifest hash.
It recomputes every native envelope from the retained raw response and copies the
cache to independent private inodes. It inventories the seed before and after the
run. Missing metadata still fails offline; no policy or dependency version changes
are used to bypass installation. Start-space checks include the actual metadata
cache size in addition to the4GiB floor. A one-package real pnpm fixture verifies
that genuine metadata passes while a future publication timestamp still triggers
the minimum-release-age rejection.

Full protected pnpm store and original reference inventories/hashes are recorded
before/after the run, including literal reference symlink text without following.
Selected public Cargo inputs are rechecked. Mjzz2c/S4h0Wf workspaces are not inputs,
are not linked into the fresh source and are never writable outputs. All writes
are confined to the two newly created task roots and their own serialization lock.

## Cancellation and publication

Optional builder hooks track actual ChildProcess objects for tool/version commands,
source tar extraction, every detached heavy step and cargo metadata. No process
control is reconstructed from a plan/report/PID file. All directly created groups
are captured in memory. Signal/resource cancellation aborts future phases, sends
TERM only to captured groups, awaits quiescence, then bounded KILL escalation only
for those still-owned groups. Invalid/never-spawned PID objects have no authority.
The controller refuses publication after abort and awaits all captured groups before
successful completion. Ordinary upstream descendants must remain in their captured
step group; lifecycle tests exercise a surviving descendant after leader exit.

Do NOT SIGKILL the controller itself: graceful SIGINT/SIGTERM/resource cancellation
is the tested path. An external kill/power loss can destroy its in-memory handles;
no automatic PID-based recovery or clean/adoptable outcome is claimed afterward.
Uncertain completion/remaining groups retain the build lock and no adoption occurs.

After a failed run, protected-input audits use a separate read-only lifecycle only
after every captured producer group is quiescent. Missing baseline inventories
remain unknown, and an audit error remains a failed outcome. A failed plan cannot
be resumed after changing source, tools or preparation inputs.

Cancellation can race an asynchronous atomic rename. Every output begins in the new
external quarantine subtree. A renamed output is preserved, never overwritten,
deleted or selected; observed abort yields UNCERTAIN_OUTPUT_PRESERVED_QUARANTINED.
Missing/unclean final completion is also uncertain. Even normal success reports
BUILT_UNSELECTED_REQUIRES_REVIEW, never native authority. Full artifact verification,
manifest-pin review and explicit native publication are separate operations.

## Validation

Actual tiny owned-process tests cover normal finish, TERM cancellation, failed spawn,
output bounds, a surviving descendant group, bounded KILL and forged PID-object
refusal. Cache tests prove independent inodes/identical source before-after manifests
and reject protected symlink aliases. Read-only prepare successfully verified real
APFS ownership, pinned tools, target and all36public Cargo cache packages; a final
fresh plan must be regenerated after any source change. The current real run has
completed dependency installation, browser regression, web compilation, executable
packaging and resource-monitor compilation. Installation reused995 packages with
zero downloads and passed pnpm's original policies for2063 lock entries. Final
protected-input auditing is pending. No build-success, adoption or service-runtime
acceptance is claimed until its terminal result is reviewed.

The first prepared run was stopped cleanly before installation/build after review found that excluded pnpm workspace subtrees were checked for symlinks before pruning. Its partial independent cache and before inventories remain preserved; it was not resumed or adopted. The corrected traversal prunes exactly `v11/projects` and `v11/links` before lstat/type validation/descent, and still rejects links everywhere copied. Real temporary fixtures exercise excluded external links and similarly named nonexcluded link rejection. Resource samples also include only the controller process public memory counters (`rss`, `heapUsed`, `external`, `arrayBuffers`). The new plan is preparation-only and requires a new Root review/GO; see `build-controller-validation.json`.
