# Issuance uncertainty and recovery contract

This is a source audit and integration contract, not a service-manager action or
recovery receipt. No service/device has been started/stopped for this audit.

## Actual ownership chain

* `src-tauri/src/managed_service_issuer.rs` holds native service-owner.lock for the
  helper session, and launcher.lock through Prepared→Issued. Prepared is persisted
  before the envelope is exposed; Issued releases launcher.lock and is delivery
  bookkeeping, not HTTP readiness or original prepared/committed IPC acknowledgment.
* Original/profile4 `serviceLauncher.ts` stores actual ChildProcess objects and
  fences callbacks by object identity. `terminateChild` sends signals only to that
  captured child and awaits exit; its5second escalation never consults PID files.
  Normal stop/fatal/update paths clear the captured child before replacement.
* Original launcher #recover/#startTrial may copy/restore databases BEFORE the
  newly spawned server obtains SQLite ownership. Therefore a free helper lease or
  successful transient SQLite lock probe does not authorize replay/recovery.
* Original `serverOwnership.ts:183–240` holds BEGIN EXCLUSIVE on the existing
  server-owner.sqlite for server lifetime, preserving inode identity and detecting
  replacement. Never delete/replace it to recover. This protects live server
  writers, not the entire prior launcher/job/backup transaction.
* Owned boot-service plist retains RunAtLoad/KeepAlive and ExitTimeOut90, and does
  not enable AbandonProcessGroup. Installed `/usr/share/man/man5/launchd.plist.5`
  lines609–613 state that launchd kills remaining SAME-process-group processes when
  its job dies unless AbandonProcessGroup=true. The original direct child spawn is
  not detached. This guarantee does not extend to a child that escapes the group.
* Original systemd unit uses KillMode=mixed/Restart=always; manager cleanup targets
  its cgroup after its main launcher stops. Runtime PID records are not authority.
* Original manager stop uses fixed launchctl bootout --wait with a120second bound,
  or original systemctl stop. Installed launchctl manual describes bootout removal
  but does NOT document --wait; success/print absence must not be invented as an
  independently proven wait-for-every-prior-process receipt.

Actual owned adapter must fatal immediately on helper EOF/failure, terminate and
reap its SAME captured child before trial fallback/DB restore, and close helper.
No fallback envelope, new child or transparent reissue after uncertain delivery.
Original native journal remains conservative until positive evidence exists.

## Bounded reboot reconciliation

Separate internal native helper `managed_service_boot_session.rs` obtains actual
kernel boot-session identity, not a timestamp/PID/configuration value. macOS uses
native sysctlbyname kern.bootsessionuuid; readonly actual API probe succeeded with
exact37byte/NUL response and UUID shape. Linux uses fixed genuine procfs boot_id,
not a caller path. Unsupported/missing/malformed reads fail; no fallback.

Native issuer journal integration is owned separately. Persist the validated boot
identity BEFORE exposing any new envelope. For uncertain Prepared/Issued only:

1. Retain native service-owner and launcher leases, verify installed selected
   artifact/profile/generation/environment through existing native selection.
2. Require both previous journal boot identity and current kernel boot identity to
   be present and valid; previous/current must differ. Missing legacy/current-boot
   uncertainty remains fail-closed. A different generation/selection is not a
   substitute for process quiescence.
3. Atomically persist retirement of the OLD epoch (and current verified boot
   identity) with existing fsync/rename safeguards BEFORE permitting new issuance.
   Poison/stop after ANY uncertain persistence failure. Never erase the journal,
   decrement/reset epoch, resurrect an old envelope/session or overflow safe53.
4. A subsequent begin uses a fresh captured child/session and next monotonic epoch;
   no secret/envelope bytes are persisted or replayed. Across an actual kernel
   reboot prior processes cannot survive, establishing the missing quiescence fact.

Required tests: changed boot succeeds only with current selection under both
leases; same/missing/legacy/malformed boot fails; altered selection fails; epoch
exhaustion fails; fsync failure poisons; retired old epoch is durable before any
new secret frame; no old frame replay on repeated restart. Actual reboot lifecycle
acceptance is still needed; unit fixtures alone do not certify OS recovery.

## Ordinary same-boot crash remains a separate gate

A safe future manager-quiescence operation runs OUTSIDE the job it stops. Native
selects a fixed verified owned unit/program/root; no renderer target/path/PID or
boolean quiescent receipt is accepted. Under its recovery lease it uses the
original fixed manager stop with a bounded deadline, and must obtain an actual
manager/kernel acknowledgment that the prior job's contained group/cgroup is dead
and cannot auto-restart during journal reconciliation. Unknown/timeout/optional
stop failure cannot count as success. Only after this opaque native evidence may
it retire uncertainty; then it releases the fence and starts the original unit.
The current source has no sufficiently grounded cross-platform quiescence primitive
or actual OS acceptance for this receipt, so no pretend implementation is supplied.
An alternative is an inherited per-epoch native lifetime lock held by the actual
service child; transferring/validating that lock needs a new private FD contract.
Neither helper-lock acquisition, PID disappearance, HTTP failure nor SQLite probe
is an equivalent substitute.

End-to-end acceptance must SIGKILL owned launcher/helper at pre-envelope,
post-Prepared, partial-delivery, post-Issued and trial-prepared boundaries; prove
no backup/restore/new writer overlaps a surviving prior child, original trial
commit/rollback semantics survive, fixed manager ownership is preserved, and reboot
reconciliation does not signal any persisted PID or replay secret bytes. Use only
owned disposable service units/state and sanitized private logs; no real providers.
