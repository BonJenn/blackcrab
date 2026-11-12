# Open-source and hosted-service delivery plan

Accepted direction: 2026-11-12. The user approved adding the open-source plus
paid hosted-service model to the delivery plan. This records the product direction
and implementation backlog; it does not claim billing or invite-only access has
been enabled. Prices, allowances and the payment provider remain undecided.

## Product boundary

- Keep the application and self-hostable backend open source, preserving existing
  licenses and upstream notices. Local agent use does not require a Blackcrab
  subscription. Users retain their own provider accounts and model charges.
- Self-hosters configure and operate their own identity, relay, database and other
  required services. Their deployments use their infrastructure accounts; do not
  silently fall back to Blackcrab or T3 production services.
- Official desktop, iOS and hosted-web releases include Blackcrab's public client
  configuration. Charge for managed remote access and its defined service limits,
  rather than treating an app download or repository fork as a billable event.
- Endpoint URLs and publishable keys are public configuration. Their omission
  from default source builds is useful configuration hygiene, not access control.
  Never ship private database credentials, Clerk secrets or provisioning tokens.
- An authorized subscriber may use a compatible fork with Blackcrab's hosted
  service under the same server-enforced account limits as the official app.
  Do not trust app branding, a client-supplied plan, a hidden URL or download origin
  as proof of payment or permission.

## Delivery order

Finish the current normal Mac installation and existing TestFlight owner trial.
Public paid launch is a separate release gate. Do not rebuild TestFlight solely
to add live checkout or replace desktop acceptance with billing work.

1. **HS01 — Reproducible local and self-hosted builds.** Document required services
   and configuration; provide examples with placeholders. Verify an unconfigured
   build supports its documented local workflows without contacting owned cloud
   services, and a configured self-hosted build uses only its chosen services.
   Official release configuration must remain explicit and traceable.
2. **HS02 — Invite-only hosted beta.** Inventory existing owner/tester access before
   restricting new signup. Introduce explicit beta access for invited accounts,
   including already-created accounts; invitation alone must not leave an
   unrestricted authenticated API. Confirm owner and invited testers can sign in
   on desktop, web and iOS, and nonmembers cannot allocate hosted resources.
   Keep the owner trial free of live customer charges.
3. **HS03 — Server-side entitlements.** Define one authoritative account entitlement
   with beta, paid, grace, expired and revoked states and an auditable operator
   override. Enforce it in the hosted API before resource allocation and remote
   session admission. Bound cached entitlement/token lifetimes and recheck active
   hosted sessions so cancellation or revocation cannot leave indefinite access.
   An unavailable billing lookup must not grant new access. Preserve tenant and
   environment permissions independently of subscription status.
4. **HS04 — Billing lifecycle.** Select the payment provider, prices, trial/grace
   rules, renewal/cancellation/refund behavior and included allowances before
   enabling live checkout. Update entitlement from authenticated provider events
   with duplicate/reordering protection and reconciliation; never trust a success
   redirect or client claim. Verify payment failure, cancellation at period end,
   expiry and restoration across all clients. Before public iOS release, check
   current storefront purchase/link rules and implement any required purchase and
   restore flow; do not assume web checkout alone satisfies every distribution.
5. **HS05 — Quotas and cost controls.** Enforce account-wide device/environment,
   concurrent connection and relevant traffic/storage limits atomically on the
   server, including across clients and worker instances. Cover unauthenticated
   abuse and cost-bearing ancillary endpoints such as uploads, hooks and telemetry.
   Add cost/usage dashboards, alerts and an operator restriction mechanism with
   explicit thresholds and a recovery runbook. Alerts are not a hard spending cap;
   document provider-metering delays and residual costs. Limits must not delete
   history, kill local agents or prevent local recovery/control.
6. **HS06 — Public paid launch acceptance.** Run the scenarios below against the
   deployed service, connect the official desktop/iOS/web flows, and record their
   source/build versions. Complete required CI and coherent PR merges to `stage`.
   Open public signup only after the entitlement, billing, quota and operational
   gates pass and prices/terms are settled. Invite-only testing can precede this.

Each phase remains **planned / unverified** until its implementation PR, merged
stage SHA and scoped acceptance evidence are recorded. Existing authentication,
connection caps, public-config adapters and deployments are inputs to this work;
they do not establish paid-service enforcement.

## Acceptance scenarios

- A clean fork works locally without a Blackcrab subscription. A self-hosted
  build uses the operator's configuration; missing configuration does not redirect
  to another company's service. Official releases contain only public client data.
- Knowing the production endpoints, modifying a plan flag, replaying a checkout
  URL or directly calling the API cannot grant beta or paid hosted access.
- Owner, invited beta user, paid subscriber, expired user and revoked user receive
  the intended access on desktop, native iOS and web. A paying compatible fork
  receives the same limits. Account switching cannot retain another user's access.
- Duplicate, delayed and reordered payment events do not double-credit access or
  undo a newer revocation. Expiry and revocation affect existing remote sessions
  within the documented bound; reconnect cannot bypass that bound.
- Concurrent devices cannot exceed shared account limits by racing requests.
  Rejected allocations create no orphaned billable resources. Retry/reconnect
  preserves command identity and never resubmits an uncertain agent action.
- Cross-account resource access remains denied even when both accounts pay.
  Cloud denial or billing failure preserves local operation, drafts and history.
- Alert delivery and the operator restriction/recovery procedure are exercised.
  Record which costs are bounded, which are merely monitored and the remaining
  exposure. The existing approval of $30/month base charges plus metered usage
  does not itself implement a spending ceiling or approve new subscription fees.

## Ownership and references

Backend changes belong in `managed-cloud`'s reviewed pinned-source adapters;
public client/build configuration spans `managed-cloud`, `managed-host`,
`managed-desktop` and `mobile-experience`. Keep entitlements authoritative on the
server and provide clear client states for beta access, payment and quota errors.
Use the existing host/receipt model instead of adding a second command writer.

This extends G8/X10 of the [parity ledger](t3-parity-ledger.md), the
[desktop delivery plan](t3-parity-plan.md) and M5/M7 of the
[iOS delivery plan](mobile-ios-parity-plan.md). Track the commercial gates
separately from inherited T3 feature parity; neither replaces the other.

Implementation references: [Clerk access restrictions](https://clerk.com/docs/guides/secure/restricting-access)
and [backend authorization requirements](https://clerk.com/docs/ios/guides/secure/authorization-checks).
Recheck provider capabilities, fees and distribution rules at implementation time.
