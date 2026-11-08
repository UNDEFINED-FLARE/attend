# UniAttend — Implementation Roadmap and Progress Log

Status key: ✅ done and tested · 🟡 done, not yet tested end-to-end · ⬜ not started

This file is the record of completed and outstanding work. Update it at the end of every working session.

## Phase 1 — Audit ✅
- ✅ Sources located and assessed (`01-AUDIT.md`)
- ✅ Security findings S1–S8 recorded
- ⬜ Read live `acvosa` schema (blocked: MCP read-only user cannot authenticate; needs owner to run `supabase db dump --schema public` or grant access)

## Phase 2 — Architecture and database
- ✅ Next.js 15 + TypeScript + Tailwind scaffold
- ✅ Migration `0001_core.sql`: tenancy, academic structure, people, roles
- ✅ Migration `0002_attendance.sql`: sessions, records, verification events, evidence, disputes, acoustic windows
- ✅ Migration `0003_saas.sql`: plans, subscriptions, payments, usage, notifications, announcements, audit
- ✅ Migration `0004_rls.sql`: RLS on every table
- ✅ Migration `0005_functions.sql`: check-in, session lifecycle, overrides, reports, onboarding
- ✅ RLS + isolation tests run against real Postgres (PGlite) — `npm run test:db`
- ✅ Target decided: `acvosa` project, isolated in schema `uniattend` (clashes found with acvosa's public.profiles, public.notifications, public.attendance_records, public.handle_new_user)
- ✅ `supabase/install-uniattend.sql`: one-transaction installer, tested beside a simulated acvosa `public`
- ✅ Installer run on acvosa and `uniattend` schema exposed (verified through the API, 2026-11-08)
- 🟡 `supabase/remove-acvosa.sql`: permanently removes the ACVOSA app (owner's decision, 2026-11-08), keeps `aa_*` and all logins; tested on a simulated copy, self-checking, not yet run on acvosa
- ⬜ Import legacy `aa_*` UNIVEN data into the UNIVEN tenant

> **Session 1 result (2026-11-07):** `npm run test` → 37/37 pass (32 database, 5 unit). `tsc`, `eslint` and
> `next build` are clean. Everything marked 🟡 compiles and is wired to tested database functions, but has not
> been clicked through against a live Supabase project yet, because none exists for UniAttend. That is the next step.

## Phase 3 — Auth and permissions
- 🟡 Email/password sign-in and sign-up, password reset, Supabase SSR session cookies, middleware refresh
- 🟡 Role-based routing (`/super`, `/admin`, `/lecturer`, `/student`) — enforced server-side in layouts and in RLS
- 🟡 Institution onboarding request → super admin approval
- ⬜ Institution-domain auto-join, SSO (SAML) for Enterprise

## Phase 4 — Core attendance
- 🟡 Lecturer: create session, rotating signed QR, live register (Realtime), close, override with note
- 🟡 Student: scan QR / enter code, GPS sampling, device hash, server verdict with explanation
- 🟡 Admin: faculties, departments, modules, venues, lecturer assignment, CSV student import
- ⬜ Timetable-driven automatic session creation
- ⬜ Excel import (CSV works now)

## Phase 5 — Advanced verification
- ✅ Verification engine (QR + GPS + device → score + reasons) in `check_in()`, covered by the DB tests
- ✅ Tables for the acoustic layer (`acoustic_windows`, `acoustic_submissions` with no read policy)
- ⬜ Port acoustic fingerprinting (`attendance-supabase/src/lib/fingerprint.js`, `capture.js`) into the student check-in screen
- ⬜ `analyse-window` Edge Function from `matcher.js`
- ⬜ Accuracy study: false-accept / false-reject on real lecture halls

## Phase 6 — Dashboards and analytics
- 🟡 Student: modules, percentages, history, disputes
- 🟡 Lecturer: module report (resolved % + worst case), CSV export
- 🟡 Institution admin: headline counts, low-attendance modules
- 🟡 Super admin: institutions, approve/suspend, plans
- ⬜ Charts, PDF/XLSX export, faculty/campus breakdowns

## Phase 7 — Commercial
- ✅ Plans configurable by super admin (no hard-coded prices), limits enforced in DB
- 🟡 Paystack webhook Edge Function (HMAC-verified, re-verified via API, amount-checked, idempotent) — written, not deployed
- ⬜ Checkout page that starts a Paystack transaction; PayFast ITN variant
- ⬜ Overdue → suspension job

## Phase 8 — Security and testing
- ✅ Cross-tenant isolation tests
- ⬜ Rate limiting on check-in (DB-level per-student throttle is in; edge rate limit not yet)
- ⬜ POPIA: retention job, data-subject export/delete flow
- ⬜ Playwright UI tests at phone/tablet/desktop sizes

## Phase 9 — Deployment
- ⬜ **Before any real students:** Supabase Auth → *Confirm email* must be ON for the acvosa project (it may be switched off during testing). Linking a student record trusts confirmed emails only.
- ⬜ Vercel project + env vars
- ⬜ Production Supabase, backups (PITR on Pro plan)
- ⬜ UNIVEN pilot tenant + import from `acvosa` `aa_*` tables
