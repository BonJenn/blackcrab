# Blackcrab Connect cloud backend

This profile prepares the original `infra/relay` backend from the pinned
`BonJenn/t3code` source, including its migrations, contracts, runtime, and tests.
It retains the original workspace and dependency lockfile. It does not add the
backend to Blackcrab's mobile npm workspace.

```sh
node scripts/prepare-managed-cloud.mjs \
  --archive /path/to/pinned-t3-source.tar.gz \
  --cache-dir /path/to/private/cloud-work
```

Preparation verifies the existing managed-host archive pin and applies recorded
changes to Blackcrab's stack, database, tunnel namespace, and dashboard. Preview
cleanup and tunnel census use the same namespace as provisioning. The original
authentication, DPoP, environment linking, held hooks, device registration,
APNs/FCM, and Live Activity implementation is retained.

The generated `blackcrab-cloud-source.json` records the original and resulting
relay files and dependency lock. Preparation installs no dependencies, creates no
cloud resources, and makes no claim of backend or remote-access acceptance.

Use the generated workspace's pinned Node/pnpm versions to install its frozen
dependencies, then run the original relay typecheck and tests before deployment.
These checks, deployed integration, and physical-device notification delivery
remain required.

Deployment uses the original Alchemy stack with Blackcrab-owned Cloudflare,
PlanetScale, Clerk, and Axiom configuration. The original production topology
creates a retained PlanetScale Postgres database with two replicas. Production
requires `BLACKCRAB_RELAY_DATABASE_SIZE` to select its compute capacity explicitly.
The example uses `PS_5` for a small new deployment; use `PS_80` to retain the
original capacity. Supported network-storage sizes run from `PS_5` through
`PS_2560`. Missing, empty, or unrecognized values stop production provisioning.
Review the provider's region-specific price before applying the stack; smaller
compute keeps the original database schema, authentication, and remote features. Non-production
stages reference the production stack's database and DNS zones and create their
own database branch.

Hyperdrive's origin connection pool is capped at 20, which is accepted by the
entry-level account limit. The upstream value of 40 can fail provisioning with
an allowed range of 5–20. Query caching remains disabled; the runtime database
role and schema are unchanged. A higher pool limit requires checking both the
Cloudflare allowance and the database's capacity.

Configure `infra/relay/.env` using the prepared `.env.example`. Set
`BLACKCRAB_RELAY_CLIENT_CONFIG_ENV` to an explicit private output file. The stack
no longer defaults to writing the checkout's root `.env`. The output includes
`BLACKCRAB_RELAY_URL` alongside the original relay and tracing keys; it includes
scoped telemetry tokens and must stay private. Set the Apple bundle identifier
to `dev.blackcrab.remote` and use Blackcrab's push credentials.

Desktop/CLI OAuth, hosted sign-in, and mobile public configuration must share the
same owned Clerk and relay settings. Preparing or deploying this backend alone
does not configure client builds. The existing `apps/relay` encrypted WebSocket
relay remains the legacy remote protocol and is separate from this control plane.
