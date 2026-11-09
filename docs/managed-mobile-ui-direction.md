# Full managed native mobile experience

Target: BonJenn/t3code `7f02de2eb8e253e0ec23f005b3cfff8e2c963be8`.
This follows the complete source export and native platform upgrade, and does
not mark any mobile parity scenario complete.

## Integration boundary

Activate the pinned native application graph, navigation and feature services
for managed workspaces. Preserve existing Blackcrab legacy host pairings,
provider sessions, queues and receipts as a separate legacy route. Do not
translate legacy session IDs into managed threads or give two runtimes write
ownership of the managed catalog.

The current read-only managed list creates its own connection runtime in
`apps/mobile/App.tsx`. Remove that owner when activating the full graph. The
pinned graph already supplies its own atom registry, connection platform,
shell/thread loaders, durable outbox, attachment uploads and foreground/
background observers. Reuse those services rather than layering a second
controller over their state.

## Lifecycle and persistence

The original App installs twelve services at module evaluation and creates
its navigation graph there. Its general runtime and atom registry are process
singletons; their disposal hooks currently target Fast Refresh. A conditional
import or mounting/unmounting the original App in a tab is therefore insufficient
for lifecycle isolation. Choose one explicit managed foundation per app process
and keep its service lifetime aligned with its root. A legacy route must not
create another managed runtime. Disposal and reentry need actual tests before
claiming a reversible mode switch.

Reuse the exact catalog codec. The existing Blackcrab managed catalog is stored
at `blackcrab.mobile.managedCatalog.v1`; its credentials are already exchanged
bearer sessions, not reusable pairing grants. Preserve disabled environments,
profiles, credential records and routing permissions. Importing an existing
catalog must be atomic and idempotent, preserve corrupt source data for recovery
and avoid loading the upstream legacy `t3code.connections` namespace. Existing
legacy Blackcrab host storage remains independent.

## Owned configuration

Keep Blackcrab bundle identifiers, URL schemes, Apple groups, Expo project and
SecureStore/database namespace. The original link prefixes, hosted URLs, share
extension, widgets, notification navigation and native composer link handlers
need explicit own-configuration adapters. Internal protocol/type names and
upstream license attribution can retain their original names.

The original cloud provider supports an unconfigured direct connection mode.
Do not enable upstream cloud credentials, relay, telemetry or update feeds.
Implement and validate Blackcrab-owned off-LAN, notification, Live Activity and
distribution services separately; an unconfigured mode is not completion of
those scenarios.

## Acceptance sequence

1. Establish runnable standalone Release platform with exact native ABI pins.
2. Render original native navigation and pair an isolated packaged host; prove
   the full graph reads the existing catalog without a second registry owner.
3. Create/resume a managed agent, stream transcript/tools, approve, queue,
   interrupt and recover uncertain writes through the host-owned contracts.
4. Verify uploads, terminal, source control, browser/preview and settings using
   the original permission/capability boundaries.
5. Exercise disconnect, host restart, app restart, background and route switching
   with multiple clients; preserve credentials and legacy state.
6. Complete the physical-device, off-LAN, notification, accessibility and
   signed-distribution gates in the parity ledger.

A Metro bundle, native build or source inventory alone does not complete these
flows. Record the actual source head, app/host versions, permissions, provider
and connection topology for each accepted scenario.
