# Acceptance evidence and native fixtures

Keep this file and CLAUDE.md identical. Read ../AGENTS.md and the dated handoff.

## Evidence standard

Each acceptance result must identify source revision, artifact/configuration
hashes, exact platform/device, scenario, assertions, exclusions and cleanup.
Distinguish source/unit tests, build verification, native component fixtures,
actual UI workflows, live cloud/provider behavior and release distribution.
Preserve failed attempts and explain which later result supersedes which failure.
Never turn a timeout, skipped test, partial phase or successful cleanup alone
into scenario acceptance. Zero provider runs is a scope limit, not agent-control
proof. Older combined-source acceptance is not an exact-current-stage certificate.

## iOS

Use the existing ios-ui runner and supported XCTest events on fresh owned
simulators. The user approved isolated XCUITest paired to an isolated test host
without provider runs or changes to existing devices. Preserve that scope.
Keep the nonsecret logging canary, nonce/device matching and official result
exports. Retention tests install upgrades without uninstalling baseline state.
Verify mutations independently through the actual shared SDK where applicable.

## Desktop

Use the original Root UI entry and normal native lifecycle when claiming those
paths passed. API/direct-FD fixtures have narrower coverage. A cgWindowNotFound
capture failure is an automation blocker, not a successful app workflow.
Do not substitute hidden UI invocation/evaluation and retain the original claim.
Control only children captured at creation; cancellation must settle operations
and leave unrelated apps, hosts, accounts and user data untouched.

## Published versus private records

Commit concise redacted result summaries and reusable harness code. Keep tokens,
pairing URLs, private logs, screenshots containing private content and large
xcresult/build products out of Git. Link retained local artifacts in the handoff
but verify existence and hashes after restart; /private/tmp paths can disappear.
