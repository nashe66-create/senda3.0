---
applyTo: "app/**/*.{ts,tsx},components/**/*.{ts,tsx},contexts/**/*.{ts,tsx},hooks/**/*.{ts,tsx}"
---

# Senda frontend instructions

Read the product overview, domain model, money-movement lifecycle and relevant provider migration notes before changing a user journey.

- The frontend is an Expo Router / React Native / TypeScript application targeting mobile and web. Preserve behaviour on iOS, Android and web; test platform-specific browser/payment-return behaviour explicitly.
- Screens render Senda domain concepts: grouped order, recipient, commitment, quote, customer payment and payout status. Prefer Senda language over provider-specific labels.
- A UI success state is presentation only. The backend is authoritative for collection, conversion and payout state.
- Do not start conversion or payouts from the client. Call the appropriate authenticated Senda Edge Function and render its verified result.
- Do not treat opening or returning from a hosted checkout browser as payment confirmation. Reload/verify payment status from the server and show a safe processing state while unresolved.
- Never make a second checkout attempt solely because a popup, redirect, app resume or network request failed. Check the existing transaction/reference first.
- Do not store API secrets in the app. EXPO_PUBLIC variables are public build-time values.
- Keep a clear distinction between plan/order status, payment status and each commitment's payout status. A parent order may be partially paid out.
- Preserve quote and commitment state when navigating between screens. Do not silently discard entered allocations or recipient selections.
- Keep loading, empty, retry, expired quote, unresolved payment and support-needed states explicit and accessible.
- The current recipient forms and some client data helpers still contain Flutterwave-specific calls and fields. Do not assume these are Fincra-ready. See docs/operations/FINCRA_MIGRATION_READINESS.md.
- Add UI tests or focused test coverage where available; run npm run typecheck, npm run lint and npm run build:web when changing shared screens or routing.
- Update screenshots, user-facing copy and product documentation when behaviour changes.
