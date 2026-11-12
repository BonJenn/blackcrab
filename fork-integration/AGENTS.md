# Host ownership, identity and launcher integration

Keep this file and CLAUDE.md identical. Read ../AGENTS.md and managed-host's guide.

These source patches connect the pinned upstream host/launcher to Blackcrab's
native ownership and background-service model. Original domain services remain
authoritative. Keep publication, activation, attachment and migration separate.
Preserve exact issuer/proof/manifest binding and reject stale or foreign owners.
Do not weaken grants, filesystem checks or origin checks to pass a fixture.

Each registry record must match its patch/payload and exact before/after source.
Original fixtures are meaningful only when they exercise the actual patched
implementation. Keep portable policy tests distinct from native component and
real OS service-control acceptance. Reconcile stacked PR bases before combining
records; do not replace another branch's runtime fixes with an older registry.

Launcher lifecycle transitions are serialized. Stop must clear any timer created
by an earlier transition even if stop was requested while that transition was
awaiting I/O. Preserve the #260 regression and its cleanup behavior.
Keep uncertain writes and receipts explicit through restart/ownership changes.

Use captured children and isolated service labels/data in native fixtures.
No process-name kills, recovered-PID adoption, user host migration or provider
runs are implied by running these integration tests. Record the exact tested
host/issuer artifacts and verify cleanup rather than only the test exit code.
