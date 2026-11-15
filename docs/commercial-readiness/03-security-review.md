# 03 — Security review

*14 November 2026. Internal review by the development team: read-only checks of the live database, the Supabase security advisor, the code and the automated test suite. **This is not an independent penetration test,** and none has been done.*

## Summary

| # | Finding | Severity | Status |
|---|---|---|---|
| S1 | Legacy prototype: any signed-in user can make themselves a lecturer in `public.aa_profiles` | **Critical** | **Fixed live 15 Nov 2026** (approved by the owner) and verified |
| S2 | Production database shared with three other applications | High | Open — needs a new Supabase project |
| S3 | Dispatch secret reuses a Supabase secret API key | High | Open — owner action |
| S4 | No staging, no point-in-time recovery, no restore test | High | Open — owner action (paid plan) |
| S5 | Leaked-password protection off | Medium | Open — Auth setting |
| S6 | No error-tracking or job-failure alerts | Medium | Open |
| S7 | CAPTCHA wired but only active once keys are set | Medium | Open — owner action |
| S8 | `pg_net` installed in `public`; `public.geo_distance_m` mutable search path | Low | Belongs to the other apps; goes away with S2 |
| I1 | 14 `uniattend` SECURITY DEFINER functions callable by `anon` | Info — by design | Each refuses without the dispatch secret or a hashed API key, or returns only public branding |
| I2 | 90 `uniattend` SECURITY DEFINER functions callable by `authenticated` | Info — by design | Each checks the caller's role and institution; covered by database tests |
| I3 | Six tables with RLS and no policy | Info — by design | Deny-all; reached only through functions |

## S1 — Legacy `aa_*` role escalation (Critical)

**Evidence (live, read-only):**
- Policy `aa_profiles_update`: `USING (id = auth.uid()) WITH CHECK (id = auth.uid())`.
- Policy `aa_profiles_insert`: `WITH CHECK (id = auth.uid())`.
- `authenticated` holds `INSERT` and `UPDATE` on `aa_profiles.role`. No trigger protects the column.
- `aa_sessions_insert` trusts `aa_profiles.role = 'lecturer'`, and `aa_profiles_select` lets a session owner read the profiles of students who attended.

**Impact:** a signed-in user — including any UniAttend user, since accounts are shared — can become a prototype lecturer, create sessions and read other users' prototype profiles (24 rows, with student numbers, card barcodes and photos). **UniAttend's own data is not reachable this way**: no `uniattend` function or policy references `public.aa_*` (checked with a search of every function body).

**Fix:** [`supabase/legacy/aa-profiles-lockdown.sql`](../../supabase/legacy/aa-profiles-lockdown.sql). A trigger forces new rows from app users to `student` and keeps the existing role on update; `anon` loses its write grants. Data is unchanged and the prototype keeps working otherwise.

**Tested:** in a local Postgres (PGlite) with the same policies and grants. Before the fix the escalation succeeds; after it the role stays `student`, other column edits still work, an administrator can still set a role, and the script can be run twice.

**Applied live on 15 November 2026** with the owner's approval. Verified live inside a rolled-back transaction: a signed-in student's `update … set role = 'lecturer'` matched their row and the role stayed `student`. `anon` no longer holds INSERT, UPDATE or DELETE on the table. It still holds TRUNCATE, which the REST API cannot reach; revoke it when the prototype is retired.

**Better long-term:** retire the prototype. If nobody uses it, revoke all grants on `public.aa_*` from `anon` and `authenticated` after a backup, and later move UniAttend to its own project (S2). Do not drop the tables without a verified backup and explicit approval.

## S2 — Shared production database (High)

The `uniattend` Supabase project also holds:
- the attendance prototype (`aa_*`, `uvn_*` migrations);
- an `acvosa` app (`units`, `unit_staff`, `stakeholders`);
- a marketplace (`Products`, `listings`, `orders`, `sellers`);
- two edge functions that are not UniAttend's (`yoco-payment`, `analyse-window`).

They share the database, the user accounts and the API keys. A weakness in any of them, as S1 shows, sits next to university data. A university ICT review will treat this as a blocker.

**Recommendation:** create a dedicated production project on a paid plan in the same region, install `supabase/install-uniattend.sql`, migrate UniAttend's data and users, and keep the current project as staging or retire it. Needs approval and a maintenance window.

## S3 — Dispatch secret reuse (High)

`supabase/push-schedule.sql` (local only, never committed) uses the same 41-character value as a Supabase **secret API key** for the dispatch secret. The secret itself is strong, but one leak would expose both. Steps:
1. In Supabase, create a new secret API key and revoke the old one.
2. Generate a new random dispatch secret (`openssl rand -hex 32`), set `PUSH_DISPATCH_SECRET` in Vercel, and update `push_config` and the `pg_cron` jobs with it.

## S4 — Recovery (High)

The project is on the free plan: daily backups only on paid plans, no point-in-time recovery, and no restore has been tried. See `06-production-readiness.md` (to be written) for the target RPO/RTO and the restore drill.

## S5–S7 — Settings to turn on

- **Leaked-password protection:** Supabase → Authentication → Policies.
- **Error tracking and alerts:** an error tracker for the Next.js app, an uptime monitor on `/api/health`, and an alert when a `pg_cron` job fails.
- **CAPTCHA:** create Cloudflare Turnstile keys, put the secret in Supabase Auth and the site key in Vercel as `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.

## What is already in place

- Every UniAttend table has RLS; tenant boundaries use composite `(institution_id, id)` foreign keys.
- The app never holds the service-role key; every request runs as the signed-in user.
- Roles are granted by admins only; sign-up cannot choose a role (tested).
- Integration credentials are encrypted with AES-256-GCM in the app; the browser never receives them; Moodle tokens travel in the request body, not the URL, and connection errors are shown as fixed messages rather than raw responses.
- Outbound integration requests: https only, private and link-local addresses refused, size and time limits (unit tests in `url-safety.test.ts`).
- API keys for `/api/roster` are stored as hashes; 120 requests an hour per key.
- Every `UPDATE` and `DELETE` in the migrations has a `WHERE` (enforced by a test).

## Tests that exist

| Area | File |
|---|---|
| Cross-institution reads and writes, role escalation, privileged functions | `tests/db/security.test.ts`, `tests/db/platform.test.ts` |
| Attendance engine, late arrivals, offline check-in | `tests/db/platform.test.ts` |
| Location rules | `tests/db/location.test.ts` |
| Install script and migration safety | `tests/db/install-script.test.ts`, `tests/db/safeupdate.test.ts` |
| SSRF URL checks, safe redirects, auth cookies, credential encryption | `tests/unit/url-safety.test.ts`, `safe-redirect.test.ts`, `auth-cookies.test.ts`, `integration-secrets.test.ts` |

## Not tested yet

Rate limiting under load, session handling across devices, file-upload fuzzing, and any test against the live deployment. These need staging (S4) first.
