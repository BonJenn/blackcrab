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

The owner has been asked to quit with Command-Q and reopen from Applications.
That result is pending at this checkpoint. The current entry retains its
initialization error for the process lifetime, so a persistent failure and a
stale startup failure need to be distinguished. Do not treat elapsed time as
the owner's answer or assume a successful relaunch.

## Continuation

Private evidence is under
`/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes/mac-release-040-v2llrqsa`.
Read `desktop-startup-fix-plan.json` for the current branch, validation directory,
PR and process handles. The worktree is `desktop-startup-fix`, branch
`fix/desktop-bundle-startup`. The temporary release-resource test and its result
are retained outside product source in `desktop-startup-diagnosis-mnb93460`.
The source contains no hardcoded public-release test pins.

Next, incorporate the owner's actual restart result. If the error persists,
obtain the specific failing native initialization check before claiming a fix;
do not disable verification, delete caches or change permissions speculatively.
Deliver a new patch version after the real fix is validated. Also make the new
workspace prominent in the primary app experience: 0.4.0 currently opens the
legacy Root interface and hides the new desktop entry below Claude in Settings.
Preserve legacy sessions, pairings and the single managed-host writer.

The release-publication handoff is tracked separately in PR269. Its successful
artifact/signature/updater/website results remain valid, but do not establish
the owner's desktop launch acceptance. TestFlight 1.0.0 (4) already exists; this
investigation does not require a mobile reupload or new account authorizations.
