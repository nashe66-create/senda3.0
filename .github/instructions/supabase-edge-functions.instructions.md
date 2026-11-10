---
applyTo: "supabase/functions/**/*.ts"
---

# Senda Supabase Edge Function and payment instructions

Read docs/architecture/MONEY_MOVEMENT_LIFECYCLE.md, docs/payments/PROVIDER_INTEGRATION_MODEL.md, docs/payments/providers/FINCRA_IMPLEMENTATION.md and docs/operations/FINCRA_MIGRATION_READINESS.md before changing provider or orchestration functions.

- Edge Functions are trusted server-side boundaries. Authenticate the user, call auth.getUser(), and scope records to that user. A service-role client bypasses RLS and does not replace explicit ownership checks.
- Provider credentials come only from server environment secrets. Never return them, log them or include them in error payloads.
- Use the shared Fincra adapter for Fincra API requests. Do not duplicate base URL, API key, request parsing, idempotency or signature logic in each function.
- Keep quote, collection, conversion and payout as distinct financial stages with different references and status fields.
- Before any external money-moving call, persist a deterministic reference and a safe in-progress/claim state atomically. Protect the claim with conditional updates or a database constraint so concurrent requests cannot create duplicate money movement.
- If a provider call times out or returns an ambiguous error after the request may have reached the provider, persist a reconciliation-required/unknown state and query the provider by the existing reference. Do not issue a new reference or blind retry.
- Never advance to conversion before verified GBP collection; never advance to payouts before verified conversion; never mark a payout completed from an unverified request response.
- Validate provider amount, currency, merchant reference, plan/commitment ownership and valid state before applying a financial transition.
- Webhook handlers must read the raw request body, authenticate the provider signature, validate event type/reference/status/amount/currency, and apply events through the idempotent database reconciliation path. Keep verify_jwt=false only for the external Fincra webhook configured in supabase/config.toml; the HMAC check remains mandatory.
- Deduplicate events. Treat duplicate events as normal. Protect against an event identifier being reused for different payload details.
- Map provider statuses explicitly. Unknown provider statuses must not be mapped to successful or failed by default.
- Keep provider event logging private. Maintain RLS and revoke table/function privileges from anon/authenticated where the service role is intended to be the only caller.
- Keep internal Edge Function invocation authenticated with the dedicated internal pattern. Never expose an internal key to the client.
- Do not assume the Fincra conversion-attempt table is currently used: the audited code creates fincra_conversion_attempts, while the current conversion function stores its main state on plans/transactions. Check before building on it.
- Do not add new Flutterwave money movement. Legacy Flutterwave functions may be historical or still used by recipient/KYC/reconciliation paths; search call sites and schedules before removal.
- Run typecheck/lint/web build where relevant and add sandbox tests for success, failure, duplicate, invalid signature, amount/currency mismatch, unknown status, timeout and concurrent request cases.
- Any changed Edge Function, secret requirement, webhook event, database RPC, JWT configuration or deployment instruction must update the Fincra implementation and operational readiness documents.
