# UniAttend security review

**Date:** 2026-11-15 · **Reviewer:** Mohamed Patel (with Claude Code) · **Branch:** feature/security-and-location

## Scope and method

An internal, code-level security review of the whole stack, read adversarially: Next.js
middleware and server actions, the single API route, all seven Supabase migrations (schema, RLS,
functions, grants, the campus-location feature), the Paystack webhook, auth handling and secrets.
The 83-test suite was run (60 of them database security tests on real Postgres via PGlite); all pass.

**Not done here:** active external testing against the live site. It serves real students'
personal data and lives on the production repo, so active attacks (scanners, injection, auth-bypass
probes) must run against a staging or test copy, with the project lead's go-ahead, not against
production.

## Result

No exploitable vulnerability was found in authorization, tenant isolation, row-level security,
payments, the attendance anti-cheat, redirects, secret handling or XSS. The codebase is well above
typical standard for these. One dependency advisory (build-time) and a few design trade-offs are
noted below.

## What was checked, and why it holds

| Attack tried (on paper) | Why it fails |
| --- | --- |
| A student makes themselves admin / super_admin | `user_roles` has RLS on and **no write policy**, so direct writes are denied. Roles change only through `grant_role` / `set_role_status`, which check `is_inst_admin` / `is_super_admin` first. Tested: "a student cannot grant themselves a role". |
| Institution A reads or writes institution B's data | Every table has RLS enabled by a loop over all `public` tables; RLS-on with no policy fails closed. Policies scope by `is_member` / `is_inst_admin`. Tested: "admin A cannot read/write B", "a row in A cannot reference B's parent even with a forged id". |
| A student mints a QR token without being in the room | `qr_sign` / `qr_step` / `qr_verify` are revoked from public/anon and never granted to `authenticated` (explicit allowlist). Only `session_qr_token`, which checks the caller teaches the session, returns a token. Tested: "students cannot read the QR signing secret or mint tokens". |
| A student checks into another institution's session with a borrowed token | Identity comes from `auth.uid()`; enrolment, student status, timing and institution operability are all re-checked. Tested: "student B cannot check in to A's session even with A's live token". |
| Pay R1, get a year's subscription | `apply_paystack_payment` requires amount **and** currency to match the plan or it grants nothing; it is granted **only to service_role**, so no logged-in user can call it. |
| Replay the payment webhook to extend twice | Unique `(provider, provider_ref)`; the on-conflict only moves `pending`→`succeeded` once, and a `for update` lock serialises concurrent deliveries. |
| Forge the webhook body | HMAC-SHA512 over the raw body, timing-safe compare, then independent re-verification against Paystack's API. |
| Open redirect after login (`?next=`) | `safeNextPath` rejects `//`, backslashes and control characters, then resolves against a dummy origin and confirms the path stays on-site. Tested in `safe-redirect.test.ts`. |
| Read another student's location | `live_locations` / `location_consents` are RLS select-only, scoped to owner or institution admin; all writes go through role-and-consent-checked functions. Admin map and "next classes" are SECURITY INVOKER, so RLS applies. |
| XSS / code injection | No `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function` in the client. |
| Leaked keys | `service_role` appears only in the server-side edge function; `.env*` is git-ignored; no secret-looking `NEXT_PUBLIC_` variables. |

All SECURITY DEFINER functions set `search_path = ''` and schema-qualify their tables.

## Worth acting on

1. **Dependency advisory (build-time).** `npm audit` flags `postcss` (high: arbitrary file read via
   attacker-controlled `sourceMappingURL` in CSS comments; GHSA-6g55-p6wh-862q), pulled in through
   Next.js 15.5.29. Practical risk here is low because the CSS is authored by the team, not
   user-supplied, but it should be cleared. Lowest-risk fix: pin a patched `postcss` via an
   `overrides` entry in `package.json`. The audit's suggested fix (Next 16.4.6) is a major upgrade
   and should be done deliberately, with the test suite as the safety net.

## Design trade-offs (not bugs), for institutions to understand

1. **QR relay / shared code.** If an institution turns `require_gps` **off**, a student can forward
   a live QR (valid 20–40 s) or share the join code to an absent friend and be auto-accepted. The
   GPS layer is the defence against this; the device layer and 20-second rotation reduce it further.
   Recommendation for institutions that need rigour: keep `require_gps` on, or lower `accept_score`
   so a code-only check-in goes to review rather than auto-accepting.
2. **SECURITY INVOKER reporting functions** (`campus_live_locations`, `my_next_classes`) rely on RLS
   rather than their own authority check. Correct today; if anyone later changes those tables' RLS,
   re-check these too.

## Recommended next steps

- Run the standalone Supabase security check (the `supabase-security-check` tool) against the live
  **test** project as an independent cross-check of RLS and grants.
- Clear the `postcss` advisory as above.
- When ready, an active external pentest against a **staging** copy (never production), with the
  project lead's sign-off: auth/session handling, the login and reset flows, rate limiting, and the
  real HTTP behaviour of the API route and RPCs.
- Add `npm audit` and the Supabase Security Advisor to CI so new advisories surface automatically.
