# Copyable continuation prompt

Continue Blackcrab/T3 desktop and mobile parity after the PUBLISHED 0.4.1 Mac
startup patch. Read AGENTS.md and the CURRENT checkpoint in docs/agent-handoff.md.
Older checkpoints preserve provenance, not active instructions. Do not restart
historical handles, reopen merged PRs or repeat completed account approvals.

P=/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes;
REL=P/mac-release-040-v2llrqsa. Read REL/desktop-patch-041-plan.json and
REL/desktop-patch-041-continuation.md for latest PR/head/handles. PR270 and PR271
are merged/unwatched. Source 62ef3868d65252ba062bbee0200d6cb74a27ea6f is the public
v0.4.1 tag. Workflow 43355513074 succeeded; actual app/DMG/updater/payload
verification passed. Preserve public 0.4.0 and 0.4.1 tags and assets.

Release: https://github.com/BonJenn/blackcrab/releases/tag/v0.4.1
Installer: https://github.com/BonJenn/blackcrab/releases/download/v0.4.1/Blackcrab_0.4.1_aarch64.dmg
Artifact evidence: REL/patch-041-delivery/final-artifact-verification-_pmt61l7/result.json.
Website PR13 merged/unwatched, main 5db4f74ca9c13a83e7a16988def991250ee080f7.
Production dpl_9R2eAnezPdPpNpStmHZb6YcthpY8 is READY. Live home, blog, changelog,
releases and Mac 0.4.1 / Windows 0.3 / Linux 0.3 downloads are verified. See
REL/patch-041-delivery/website-publication-verification.json. No republish needed.

The owner's installed work-Mac version is only confirmed at 0.4.0. Its binary,
both payload hashes and cache/lock checks passed; restart did not help. Full
desktop was disabled with ONE unavailable line. 0.4.1 removes the client runtime-
marker assumption and preserves native startup errors. Automated regression
tests pass, but the owner's actual cause/resolution remains unconfirmed. Ask
them to try Settings → Full desktop → Open full desktop in 0.4.1, and obtain
complete status/error text if unavailable. Do not delete/repair app data or
request repeated old diagnostics. The old report only validates 0.4.0 hashes.

Native UI/lifecycle/upgrade acceptance remains deferred under the owner's
publication/testing instruction, never PASSED. Continue normal service setup,
desktop reuse, quit/reopen, restart and retained data tests. Make Full desktop
available from the primary experience: Root still opens the legacy UI. TestFlight
1.0.0 (4) is already available; no new mobile build was included in this patch.
Remaining physical mobile/off-LAN/push acceptance, branding publication and the
hosted-service model are in the parity ledger/plan. Preserve the distinction
between implemented, integrated, runtime-validated and delivered functionality.

All owned shell/build handles are settled; the verifier's read-only mount was
ejected. No owned app/host/service/simulator/browser is running. Main dirty
checkout/index and shared caches were preserved. Existing cloud-key use and the
smaller backend budget are authorized. Keep sessions, credentials and pairings.
The handoff PR in REL/patch-041-handoff needs checks/merge to stage; find its URL
in the plan. Link PRs after create/takeover/push; for PR waits, watch and end.
Keep AGENTS.md and CLAUDE.md identical per directory. Finish line remains tested
parity plus a usable normal Mac installation and owner TestFlight availability.
