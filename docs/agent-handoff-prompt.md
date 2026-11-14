Continue Blackcrab parity and the authorized 0.4.4 release for all three desktop platforms.
Read AGENTS.md and the current checkpoint of docs/agent-handoff.md first. Keep the
extensively dirty main checkout untouched and paired AGENTS.md/CLAUDE.md identical.

The immediate owner task adds Google/GitHub/Apple sign-in, removes the extra mobile
Blackcrab/Legacy hosts header, delivers Blackcrab account branding, and adds bottom
button haptics. Worktree P/mobile-account-recovery-e49g7nr9/source is on
feat/mobile-connect-polish; P=/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes.
Read parent mobile-connect-plan.json and mobile-connect-export-result.json for
latest head, running handles, PR and validation. The extra header is removed;
retained paired hosts are in Settings using the existing voice/root ownership
guard. Tab/compose haptics use native user events and cannot block navigation.
Full physical mobile validation/export and actual update delivery are distinct.

Native API is ENABLED in the verified Blackcrab Clerk production instance. PR291
merged at 0b305bc3079b0568370f3c0836f2a4c3f48331bb and is unwatched. PR292 is watched,
head dc9d179dc7fe44703e53d45cbb9637d50628b13d, and fixes the preflight response shape.
Do not relink/watch it again on its wake, or re-ask for Native API activation.
The handoff records the correct Marketplace app/instance, GitHub OAuth app and
redirect URI. GitHub Confirm access verification is pending before generating its
secret; Google Cloud and Apple Developer owner sign-ins are pending. No social
provider has been claimed enabled or tested. Use Clerk's existing AuthView, finish
provider/native registration, and never expose secrets. Native iOS registration and dev.blackcrab.remote://callback allowlisting are done.
The shipped ClerkKit uses browser OAuth for Google/GitHub and native Apple. Clerk
rejected Apple activation without production custom credentials; it stays disabled.
Do not require a new Google native SDK based only on newer generic documentation.

The earlier account-only branded export at /private/tmp/blackcrab-ios-yP6Wlk is
unpublished and superseded by current polish once verified. Installed TestFlight
is 1.0.0 (4), runtime 2cbb84d9fbdb180f1af5bfe3e049108c47d628cb. Verify retention,
reconnect, update and rollback before production delivery. Don’t claim source
exports or provider switches establish sign-in/remote access on the owner's phone.

Updater PR290 is merged and unwatched; its existing validation/producer in
P/mac-release-040-v2llrqsa/workspace-044-validation is complete. Mac 0.4.3 and
Windows/Linux 0.3.0 remain public; 0.4.4 is not built or published. Implement the
remaining Windows/Linux native package/service/transport, validate real installers
and signed updater behavior, publish, then update website/blog/release notes.
Preserve Mac service manifest c04c4d4498a552d3c1ca26c2d600ddde7ed513c8c6030d5f7ce79ece15f45e83
pending a stopped data-preserving migration. No extra publication permission is needed.

Full Connect two-computer+iOS sign-in/discovery/off-LAN agent control/revocation/push
remains open. Free local/self-hosted plus paid hosted beta is the accepted model.
Finish with validated parity, a current normal Mac installation, a working available
TestFlight app and the Windows/Linux delivery. Keep this handoff current.
