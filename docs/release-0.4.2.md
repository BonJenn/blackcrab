# Blackcrab 0.4.2 — Full desktop startup

Draft release notes. The installer and end-to-end runtime validation are pending;
these notes do not announce a published update.

This Apple-silicon Mac update corrects background-service startup in 0.4.1.
Blackcrab now packages a dedicated signed service helper instead of copying its
main application executable out of the signed app bundle. An inactive service
can update that helper while keeping the workspace configuration and identity.

A Full desktop button in the main Claude and Codex toolbars puts background-service
setup beside Open full desktop. Enable or start the service there, then open the
full workspace. Setup/start failures now keep the action available for retry and
show the relevant instructions.

Existing conversations, workspace data and pairing identity are preserved. This
release is for Apple-silicon Macs; it includes no new iOS, Windows or Linux build.
See the public release only after its final installer and runtime checks finish.
