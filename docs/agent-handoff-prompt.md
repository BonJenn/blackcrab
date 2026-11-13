Continue Blackcrab parity and delivery. Read AGENTS.md and the Current checkpoint
in docs/agent-handoff.md before historical notes. All three latest owner fixes
(complete UI branding/version, visible external drives, correct pane image drops)
are merged in stage 1140889d5a6730d336b6f1a16347d2d1d33ca82c after nine checks per PR.
PR277–279 are merged/unwatched. Four real-browser tests and full types pass.

REL=/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes/mac-release-040-v2llrqsa.
Read REL/workspace-polish-042-plan.json for live handles and evidence. Frozen source:
REL/workspace-polish-042-release. D=REL/workspace-polish-042-delivery. The production
desktop build runs on original shell handle 20725; resume it and wait for its result.
Do not duplicate it. Signing/preparation scripts are ready but not yet run. Keep
existing service artifact/pin; only the desktop client changed. Internal disk space
is low: use external temp/output and preserve all user data/shared caches.

Build/sign/notarize, replace only the verified superseded private 0.4.2 draft,
build Root, verify exact installer/helper/payload/updater artifacts, then test
actual UI/lifecycle and install/publish normally. The current running app is the
previous candidate and does not include the latest fixes. Keep source, runtime
acceptance and publication status distinct. Website bb01d27 is prepared and all
local checks pass, but remains unpushed until the Mac installer is public.
TestFlight 1.0.0 (4) is available; full parity remains uncertified. Keep this handoff
and the live plan current, including when original background commands finish.
