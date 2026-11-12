# Copyable continuation prompt

Continue the authorized Blackcrab/T3 parity and delivery task; do not restart it.
Read AGENTS.md, docs/agent-handoff.md (current checkpoint first), the parity plan
and ledger, and nearest paired guides. Keep this file and the handoff current.

The owner wants a signed update for their existing Blackcrab app on an
Apple-silicon work Mac, including the full desktop and background service.
They are away from the build Mac. Do not ask them again to inspect/unlock it now.
Full parity and desktop installation are NOT complete; TestFlight 1.0.0 (4) is
already available to the owner. Installation and release work are authorized.

P=/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes.
W=P/desktop-delivery-m6ki1jlt/source, branch parity/desktop-delivery-integration.
Resolve HEAD/status: the 17-branch local integration base was 1da28f8d137ee8ad5835bce8d7f389ffe39c2a3c,
with integration/release fixes now committed as 4d88e5f. Stage
a52826650a0c080421e8c1c6db5ab29cddba0c13 (#264) is merged, preserving its branding
adapters and these newer handoffs (merge a3035e9). Read
P/desktop-delivery-m6ki1jlt/integration-pr.json for the draft PR URL/head/check
state and verify GitHub. Checkpoint: 2026-11-12 20:41 UTC. Preserve the extensively dirty main checkout
/Volumes/G-DRIVE PRO/Programming/blackcrab and its index. Stage explicit files only.

Immediate action: inspect R/integration-pr.json; create the DRAFT only if absent,
otherwise act on its current CI results.
Actionlint 1.7.12 passes both workflows; 24 launcher/QA/freeze tests pass.
Native UI acceptance remains a final merge/delivery gate. All old build handles
are settled; no owned app/host/simulator is running. Do not restart builds blindly.

Actual completed evidence:
- Combined service producer and its final protected-input/captured-child audits passed.
- Combined original Root QA typechecks, build and focused native policy tests passed.
- All 20 desktop and 17 host binaries are Developer ID signed for YF28W3NGG6.
- Apple Accepted 2958751f-0bbd-4d03-bc20-e805a52acfc2; no issues. All 37 CDHashes
  match the tickets. Desktop stapling/Gatekeeper and real native archive roundtrip pass.
- Final notarized payloads are under
  /private/tmp/blackcrab-parity-work-i5v1q577/Root-QA/desktop-delivery-notarized-31e0815b/payloads/{desktop,service-host}.
  Read R/notarized-resource-roundtrip.json, notary-ticket-audit.json and signing receipts.
- Real service-only wrapper regression passed 1/1; focused integration tests 18 pass,
  1 opt-in skip; portable release/resource tests 23 pass, 3 opt-in skip.

Blocked scope: actual QA Root n31e0815bab7aa86a launched and reported a visible
window, but CUA returned -10005 cgWindowNotFound via bundle ID and exact path.
The owner is away. Original controller 60816 stopped cooperatively, cleanup passed,
zero service initializations/actions/native children/provider commands.
R/root-qa/native-ui-capture-status.json is authoritative.
NO root-qa/native-ui-acceptance.json exists. Never fabricate it.
The old controller root is already used; a retry needs fresh reviewed identity/
package, preserving prior evidence. Native UI must check explicit first enable,
ready state, desktop open/reuse, quit with host survival, reopen retaining
identity/catalog, service restart/stop/start/reconnect and cleanup.

New scripts/macos-release/ tools sign immutable copies, notarize and verify both
source and archive-extracted signatures/tickets. Read its README and paired guide.
release.yml now uses explicit dispatch: managed Apple-silicon is default, historical
root-only is explicit; tag creation no longer triggers the old build. The managed
route pins inputs and real lifecycle evidence to the exact clean committed stage
source, uses the existing GitHub updater key in its intended Tauri job, rejects
stale platform metadata, and leaves a draft release. It has NOT run end-to-end.
Current root version remains 0.3.0. After acceptance/review/CI/merge, commit a newer
stable version, prepare the accepted input archive, build signed outer app/DMG/
updater, verify final embedded resources and updater cryptography, install/test
retention/update/reconnect, then publish. No new normal app is installed yet.

Mobile priority follows desktop. P/mobile-owned-branding-4pdd465l/source has merged
#264 (996caea; unwatched) and only handoff edits afterward. The exported JS runtime
matches accepted build 4, but its actual HBC still includes shared-runtime T3 Connect
and T3 Code strings. No OTA published. Read runtime-product-copy-findings.json and
update-export-artifact-audit.json; implement recorded shared-client patches, not
vendor edits. Preserve genuine T3 Chat/GitHub App references and protocols.
TestFlight owner availability, exact accepted IPA/build/runtime, cloud account
state and all artifact paths are in the main handoff. Do not upload build 4 again.

Use existing authorized cloud keys privately; budget $30/month base plus metered.
No repeated rotation/account-approval hold. Signed-in/off-LAN/provider/APNs and
legal-policy publication remain separate. Accepted model is free open-source
local/self-hosted use plus invite-only then paid hosted access enforced server-side;
HS01–HS06 planned. No prices/provider chosen. Never print secret values.

No new unasked agents, threads or replacement goals. Do not kill unrelated apps,
adopt PIDs or restart T3. Preserve original captures, shared caches and user data.
Link every created/pushed/taken-over PR immediately as next tool call; watch then
end when waiting on required checks, never poll. Unwatch before owner handback.
Read R/integration-pr.json for the current watch/check state. Keep handoffs and
paired guides current.
