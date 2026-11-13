# Mac 0.4.0 disabled Full desktop investigation

The owner installed the published release and reports that Settings → Full
desktop says unavailable and its Open button is disabled before any click.
The Background service section and Enable button are present. Both managed
resource archives are present in the installed app. This is an unresolved
runtime failure, not accepted desktop parity.

## Verified evidence

The owner's `/Applications/Blackcrab.app/Contents/MacOS/blackcrab` is arm64 and
has SHA256 `4f964a7daa50f4b794da504254c4bcd95627969f850a4f26bfd00a4ebdbd88d7`,
identical to the verified public 0.4.0 executable. Its release source remains
`caf57b6fab1b4391836c6635882a15a88edfac0d`. Do not replace the public tag/assets.

The owner reports application-data permissions 755, private payload-cache
permissions 700 and marker permissions 600, all owned by UID 502. The marker
has one link. These are expected values; no ownership repair is justified by
this evidence. The build Mac uses a different UID, which is normal; native
checks use the effective runtime UID, not a build-user constant.

Four existing native-entry tests passed on the build Mac. A separate temporary
test invoked the production constructor/status code against the exact public
resource files with their four published pins and fresh disposable app data;
it returned ready, then removed only its owned test data. That test did not
launch the released executable or the full desktop, and does not reproduce or
resolve the owner's failure.

## Current change and limits

The native entry previously discarded initialization errors and returned the
same generic message for missing files, invalid file types, incomplete build
pins, inaccessible app data and private-cache initialization failures. The
current change retains distinct messages while preserving the disabled state
and all verification/ownership requirements. It does not claim to fix the
underlying launch failure. Six native-entry tests pass, including checks that
missing packages remain disabled and an unrecognized cache is not adopted or
modified. No production cache, session data or app installation was changed.

The owner fully quit with Command-Q and reopened from Applications. The desktop
is still unavailable: this is persistent, not merely a stale process state.
Do not ask for another reinstall or repeat that restart as if it were untested.

`scripts/diagnose-macos-040.pl` is a read-only report for this exact published
version. It uses the Mac's system Perl to compare the executable and resource
archive digests, check cache paths/ownership/modes/marker contents and the
initialization lock, and list the paths of running Root executables. It does
not launch the app, extract archives, repair permissions, read sessions or
change data. The initialization lock is only acquired nonblocking and immediately
released through a read-only descriptor. Run with the normal defaults on the
owner's Mac; optional --app and --data paths support isolated validation.
An all-passed report would not establish native UI startup success.

The renderer also now preserves native string rejections instead of replacing
them with "Desktop request failed." A real native command rejection needs to
remain distinct from a returned unavailable status.

## Continuation

Private evidence is under
`/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes/mac-release-040-v2llrqsa`.
Read `desktop-startup-fix-plan.json` for the current branch, validation directory,
PR and process handles. The worktree is `desktop-startup-fix`, branch
`fix/desktop-bundle-startup`. The temporary release-resource test and its result
are retained outside product source in `desktop-startup-diagnosis-mnb93460`.
The source contains no hardcoded public-release test pins.

Next, inspect the owner's diagnostic report and obtain the specific failing
native initialization check before claiming a fix;
do not disable verification, delete caches or change permissions speculatively.
Deliver a new patch version after the real fix is validated. Also make the new
workspace prominent in the primary app experience: 0.4.0 currently opens the
legacy Root interface and hides the new desktop entry below Claude in Settings.
Preserve legacy sessions, pairings and the single managed-host writer.

The release-publication handoff PR269 merged after nine passing checks to stage
`39e2c7f6c0813682741bae6a6cceabe9fea4e4fe` and was unwatched. Its successful
artifact/signature/updater/website results remain valid, but do not establish
the owner's desktop launch acceptance. TestFlight 1.0.0 (4) already exists; this
investigation does not require a mobile reupload or new account authorizations.
