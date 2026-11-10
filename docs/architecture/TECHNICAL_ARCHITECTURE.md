# Senda — technical architecture

## 1. Stack observed in the repository

| Layer | Current technology | Responsibility |
|---|---|---|
| Mobile/web client | Expo, React Native, Expo Router, TypeScript | Customer journeys and presentation |
| UI components | React Native components and shared components | Consistent forms, buttons, status display |
| Client data layer | lib/data.ts | Authenticated Supabase and Edge Function requests, data mapping |
| Authentication | Supabase Auth | Session identity |
| Database | Supabase Postgres | Customers, plans, recipients, commitments, transactions, attempts and event history |
| Server operations | Supabase Edge Functions (Deno) | Quote, checkout, conversion, payout, webhook and orchestration logic |
| Provider client | supabase/functions/_shared/fincra.ts | Server-only Fincra API adapter |
| Hosting | Cloudflare Pages for web export; Expo tooling for mobile development | Static web delivery / app build workflows |

The package scripts in the audited main snapshot include dev, dev:local, dev:web, build:web, lint and typecheck. There is no test script in package.json at that snapshot.

## 2. Runtime boundaries

### Client
The client can:
- authenticate the user through Supabase;
- read/write user-owned application records through the Supabase client and RLS;
- call authenticated Senda Edge Functions;
- open a provider-hosted checkout page;
- display verified server-side payment and payout statuses.

The client must not:
- hold a Fincra or Flutterwave secret API key;
- call privileged provider money-movement endpoints directly;
- decide that collection, conversion or payout is successful;
- invoke conversion/payout just because a checkout redirect returns;
- hold service-role, cron or internal function secrets.

All EXPO_PUBLIC variables are bundled into public client output. They are not secret storage.

### Supabase Edge Functions
The server is responsible for:
- validating user identity and ownership;
- calculating and persisting quote values;
- enforcing state prerequisites;
- calling Fincra with server-held credentials;
- saving stable references before external money movement;
- authenticating and reconciling webhooks;
- invoking conversion and payout stages in order;
- returning safe user-facing errors without exposing secrets.

The standard Supabase runtime values include SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Fincra-specific settings are described in FINCRA_IMPLEMENTATION.md.

### Database
The database is responsible for:
- storing authoritative plan, transaction and commitment state;
- enforcing ownership and integrity through RLS/constraints;
- retaining provider references and reconciliation evidence;
- applying provider events transactionally and idempotently through apply_fincra_webhook_event.

The service role bypasses RLS. Every server function using it must still check the authenticated user and explicitly filter user-owned rows, except trusted internal operations with a validated internal secret.

## 3. Core application entry points

- app/plan/new.tsx — start a grouped order and create commitments from selected recipients.
- app/plan/[id].tsx — order detail, recipient commitments, quote, lock, payment navigation and status/resolution actions.
- app/collect/[transactionId].tsx — hosted Fincra checkout and payment verification/polling.
- app/recipient/[id].tsx — create/edit recipient details; current save/verification path still has Flutterwave dependencies.
- contexts/AuthContext.tsx — Supabase session/profile context.
- lib/supabase.ts — Supabase client initialisation.
- lib/data.ts — main application data and Edge Function integration layer.
- types/database.ts — manually maintained TypeScript domain interfaces; currently behind some Fincra schema changes.

Use these as navigation points, not as an exhaustive list. Search all call sites before changing a shared function.

## 4. Edge Function inventory

| Function | Current purpose in main source | Notes |
|---|---|---|
| senda-quote | Validates order allocations and asks Fincra for quote | Requires authenticated user and verified KYC profile |
| senda-orchestrate | Locks quote, cancels eligible unpaid order and recalculates parent status | Legacy money movement actions return 410; does not execute new Fincra payout flow |
| fincra-checkout | POST starts hosted GBP checkout; GET looks up and reconciles checkout status | Uses transaction/order reference |
| fincra-conversion | POST starts or reconciles order-level GBP to destination currency conversion; GET queries reference | Requires funded plan and Fincra GBP wallet balance |
| fincra-payout | POST pays one commitment; GET queries/reconciles payout | Requires collection and conversion successful |
| fincra-webhook | Receives authenticated Fincra collection/conversion/payout events | verify_jwt=false in config.toml; HMAC signature remains mandatory |
| fincra-wallet | Restricted wallet listing/balance lookup | Requires FINCRA_WALLET_INTERNAL_SECRET |
| _shared/fincra.ts | Fincra API configuration, requests, references, endpoint helpers and webhook signature verification | Server-only |
| _shared/internal-functions.ts | Authenticated internal function calls and fan-out to ready commitments | Server-only |
| senda-recurring-cycles | Creates a fresh draft order for due completed recurring plans | Requires a trusted cron secret; new cycle needs new quote/payment |
| senda-payout-reconciliation | Scheduled payout reconciliation code | Still calls Flutterwave in the audited main snapshot; migration gap |

Other Flutterwave-specific Edge Functions remain in the tree. See the migration-status document before using or removing them.

## 5. Fincra request boundary

The shared adapter resolves the base URL from FINCRA_BASE_URL or FINCRA_ENV. If no explicit URL is set, sandbox is the default; production selects the production API URL. It reads FINCRA_SECRET_KEY, with FINCRA_API_KEY as a fallback, and sends the secret in the api-key header.

Fincra calls originate only inside Edge Functions. The frontend calls the Senda function endpoints using the user's Supabase session.

## 6. Database and migration conventions

The database schema is represented by ordered SQL files in supabase/migrations. Migrations from August/September establish the original remittance schema, security, quote/order controls, financial reconciliation, recipient snapshots and payout resolution. November 2026 migrations add Fincra collection/conversion/payout state and webhook event reconciliation.

Treat committed migrations as desired schema history, not as proof of deployed state. Before relying on a new column/function in production, check the target project's migration history and schema.

Do not edit previously applied migration files. Add a new migration for corrections. Consider existing data and historical Flutterwave records before changing or dropping provider-specific columns.

## 7. Hosting and builds

The web app is exported through Expo using npm run build:web; Cloudflare Pages builds from the repository. A successful Pages deployment validates the web export/build but does not deploy Supabase Edge Functions or apply SQL migrations.

The local development environment uses Expo commands defined in package.json. See docs/standalone-prototype.md for local setup and web-hosting setup.

## 8. Security boundaries

- Client: publishable/anon key only, authenticated session, RLS.
- User-facing Edge Function: validate bearer token with Supabase Auth and scope data to user.
- Trusted internal Edge Function: require the agreed internal credential and restrict the function's accepted actions.
- Fincra API: server-side secret key only.
- Fincra webhook: platform JWT disabled so Fincra can call it; verify HMAC-SHA512 against raw body before processing.
- Provider event database table and reconciliation function: no public/anon/authenticated access; service role only, as configured by migration.
- Cron: independent high-entropy secret; never exposed to client.

Review these boundaries whenever a function is added or moved. CORS is not authentication.
