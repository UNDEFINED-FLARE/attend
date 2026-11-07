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
- ⬜ Create the Supabase project and apply migrations (needs owner decision — see README)

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
- ✅ Verification engine (QR + GPS + device → score + reasons), unit-tested
- ⬜ Port acoustic fingerprinting into the student check-in screen
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
- ⬜ PayFast / Paystack webhook Edge Function (signed, server-verified)
- ⬜ Overdue → suspension job

## Phase 8 — Security and testing
- ✅ Cross-tenant isolation tests
- ⬜ Rate limiting on check-in (DB-level per-student throttle is in; edge rate limit not yet)
- ⬜ POPIA: retention job, data-subject export/delete flow
- ⬜ Playwright UI tests at phone/tablet/desktop sizes

## Phase 9 — Deployment
- ⬜ Vercel project + env vars
- ⬜ Production Supabase, backups (PITR on Pro plan)
- ⬜ UNIVEN pilot tenant + import from `acvosa` `aa_*` tables
