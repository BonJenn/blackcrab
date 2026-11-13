# Blackcrab-owned cloud integration

Keep this file and CLAUDE.md identical. Read ../AGENTS.md and the handoff.

Reuse pinned shared client/backend behavior with Blackcrab-owned infrastructure.
The selected domain is blackcrab.app; hosted app and relay use explicit owned
origins. Preserve the existing landing site and DNS records during deployment.
Do not silently use T3's Clerk, relay, Expo, Axiom or hosted-app resources.

## Configuration and validation

Public client inputs and private backend credentials have separate boundaries.
Validate whole configuration groups, HTTPS origins, schemes/channels and native
link associations. Never embed a Clerk secret, database password or API token
in desktop/mobile/browser assets. Preserve strict pairing-envelope validation.
Use fresh client/backend source preparation and complete upstream typechecks.
Run the original account/link/relay tests affected by a patch.

## Current operational context

The user accepted the open-source plus paid hosted-service direction on
2026-11-12; follow ../docs/hosted-service-plan.md. Default source builds remain
local/self-hosted with explicit configuration. Official endpoints are public;
server-side beta/subscription entitlements and account-wide quotas must protect
hosted resources even from modified clients. Invite-only beta precedes public
paid signup. Do not mistake this plan for implemented billing or silently enable
live charges before prices, provider and launch acceptance are settled.

Account/project setup exists for Clerk, Cloudflare, Axiom, PlanetScale and Vercel.
That is not evidence the database/relay/hosted app are deployed or usable.
Cloudflare R2 and expanded Secrets Store scopes were authorized. Nameserver
delegation was verified publicly after the user's GoDaddy change.
Read the dated handoff and private setup reports before asking for access again.

The user approved at most $30/month in base charges plus metered usage.
The reviewed small database/Workers configuration was approximately $20/month
base. Reverify live pricing before provisioning; do not deploy the inherited
larger database tier. Do not treat account creation as approval of new charges.

A prior diagnostic exposed credentials. Axiom and PlanetScale replacements
were verified and old values revoked. On 2026-11-12 the user explicitly
authorized using the existing Clerk key and continuing deployment, superseding
the earlier rotation hold. This authorization does not permit logging keys.
Never print environment objects or secret-bearing assertion diffs.

Live sign-in, relay pairing, cross-network remote agent control, revocation,
push/Live Activities and service recovery need end-to-end evidence after setup.
Do not mark those complete from configuration tests or successful DNS alone.

## Shared desktop and hosted patch composition

Hosted source is prepared by applying the full managed-desktop patch chain first.
When shared branding changes legalLinks, WelcomeWizard or HostedEmptyState, rebase
the hosted-specific deltas on those exact new bytes. Preserve hosted privacy URL
configuration and connection instructions; do not replay old upstream branding
replacements or weaken hash checks. hosted-source.test.mjs exercises those actual
layer boundaries; also prepare fresh single-origin and channel sources.
