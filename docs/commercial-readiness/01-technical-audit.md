# 01 — Technical audit

*Audited 14 November 2026 against `main` at `8f32c28` and the live Supabase project `uniattend` (ref `rbnnbmduwrvokhbkezyh`, eu-west-1, Postgres 17). Live checks were read-only SQL queries and the Supabase security advisor. Nothing in the live database was changed during the audit.*

How to read the status words used here and in the gap register:

| Word | Meaning |
|---|---|
| **Verified complete** | In code, in the live database, deployed, covered by automated tests, and seen working with real use. |
| **Implemented, tested** | In code and passing automated tests (PGlite database tests and/or unit tests). Not yet proven with a real university. |
| **Implemented, untested** | In code, no automated test. |
| **Not deployed** | Written but not live (missing migration, edge function, environment variable or build). |
| **Partial** | Some of what the brief asks for exists. |
| **Missing** | Not built. |
| **Blocked** | Needs access, credentials or a decision from someone outside the codebase. |

Passing tests is not proof of production readiness. No feature in UniAttend has yet been verified with a real university pilot, so nothing is marked *Verified complete*.

---

## 1. Architecture (as built)

| Layer | What is used |
|---|---|
| Web app | Next.js 15 App Router, React 19, TypeScript (strict), Tailwind CSS 4. Server actions and a few route handlers. No separate API server. |
| Database | Supabase Postgres, all UniAttend objects in schema `uniattend`. Row-level security on every table. Business rules in `SECURITY DEFINER` functions with `search_path = ''`. |
| Auth | Supabase Auth (email + password, email links). Roles in `uniattend.user_roles`: `super_admin`, `institution_admin`, `lecturer`, `student`. Roles are granted by admins, never self-selected. |
| Background work | `pg_cron` in the database: `uniattend-push` (every minute), `uniattend-retention` (00:30 daily), `uniattend-classes` (23:00 daily). Integration runs and push delivery are claimed by the app's `/api/push/dispatch` route, guarded by a shared secret. |
| Hosting | Vercel (production domains `attend-seven-liart.vercel.app`, `attend-blueflare.vercel.app`). |
| Mobile | Capacitor 8 Android shell (`android/`) loading the web app; local notifications; device biometric app lock (`@capgo/capacitor-native-biometric`). Debug build only. |
| Validation | Zod on server actions; database constraints and checks. |
| Tests | Vitest. 19 unit test files; 6 database test files that run every migration in PGlite and test as real roles. Last run: **230 / 230 passed**, build and lint clean (14 Nov 2026). |

The app never uses the Supabase service-role key. Every request runs as the signed-in user, so database permissions are the real boundary.

## 2. Migrations: repository versus live database

The repository has 27 numbered migrations (`supabase/migrations/20261107000001_core.sql` … `20261114000027_timetable_events.sql`) and a generated bundle `supabase/install-uniattend.sql`.

**They are applied by hand in the SQL editor, so Supabase's migration history does not list them.** `supabase_migrations.schema_migrations` holds 42 entries, all from *other* projects that share this database (`acvosa_impactos_*`, `aa_*`, `uvn_*`). It cannot be used to tell which UniAttend migrations ran.

Reconciliation against the live schema instead:

| Check | Result |
|---|---|
| Tables in the repository's migrations | 53 |
| UniAttend tables live | 51 |
| In the repository but not live | `live_locations`, `location_consents` — **expected**: migration 0017 removed campus location sharing and drops them. |
| Live but not in the repository | none |
| 0024 integrations (`integrations`, `integration_secrets`, `integration_seen`) | present |
| 0025 sync engine (`integration_runs`, `integration_staging`, `integration_external_ids`, `integration_errors`, `_sync_process`) | present |
| 0026 import mappings (`integration_mappings`) | present |
| 0027 timetable events (`timetable_events`, `institution_settings.attendance_kinds`, `open_event_session`, cron `uniattend-classes`) | present |

**Conclusion: all 27 migrations are applied live.** The blueprint's statement that 0024 and 0025 were not applied was out of date and has been corrected. No migration needs to be run now.

Recommended change: from the next migration on, record each one in a `uniattend.schema_versions` table (or apply with `supabase db push`) so this check is a query, not detective work.

## 3. Live data (counts only)

3 institutions (UNIVEN, UL, TUT, on Starter trials ending 8–9 December 2026), 142 students, 25 lecturers, 724 modules, 14 class sessions, 258 attendance records, 4,366 dated timetable classes, 0 integrations configured, 5 import runs, 0 payments. Only 10 people have app roles (1 super admin, 4 institution admins, 2 lecturers, 3 students); the rest are roster entries not yet linked to an account.

The `uniattend-push` and `uniattend-retention` jobs last ran successfully. `uniattend-classes` is scheduled and has not had its first nightly run yet; classes were prepared by hand.

## 4. Features that exist

| Area | What is there |
|---|---|
| Institutions | Self-service request → super-admin approval; domains; settings; branding and theme versions; plans and trials; manual billing records. |
| Academic structure | Campuses, faculties, departments, programmes, academic periods, venues (with map outlines), modules, lecturer assignments (primary/assistant), enrolments with groups. |
| People | Students and lecturers as roster rows, linked to accounts by email or number on sign-up; CSV add; role grants by admins. |
| Timetable | Weekly slots (manual, CSV, PDF and timetable-link import); dated classes for two weeks (0027); cancel, restore, move, change venue, substitute lecturer, attendance on/off; group-targeted notifications; ICS calendar feeds. |
| Attendance | Lecturer opens a session (or a class); rotating QR (`session_secrets`, step tokens); venue geofence; device binding; late arrivals with lecturer decision; manual register with reasons for corrections after close; custom statuses; disputes; offline check-in queue with server validation; early-warning alerts for low attendance. |
| Integrations | Sync engine (stage → validate → match by external ID then natural key → preview with rollback → atomic commit → error report, checkpoints); Import Centre (CSV/Excel/TSV, column mapping, saved mappings, preview, report, rejected-rows download); Integration Centre (dashboard, provider catalogue, setup wizard, activity log); Moodle web services connector; scheduled CSV/JSON link with bearer token; institution-pushed `/api/roster` with hashed keys and a rate limit; AES-256-GCM encrypted credentials; SSRF guard (https only, private address ranges refused). |
| Notifications | In-app, web push (VAPID), Android local notifications, targeted announcements, class reminders. |
| Governance | Privacy notice, terms, PAIA manual pages; consent records; personal-data export (`/settings/my-data`); data requests; retention job; audit log; draft operator agreement, retention schedule, breach plan, security policy in `docs/legal/`. |
| Monitoring | `/api/health` (database round trip), optional `ALERT_WEBHOOK_URL`. |

## 5. Security controls that exist

- RLS on all 51 UniAttend tables; six of them deliberately have **no** policies (deny-all, reached only through functions): `integration_secrets`, `integration_seen`, `integration_seen_modules`, `push_config`, `session_secrets`, `acoustic_submissions`.
- Composite `(institution_id, id)` foreign keys so a row cannot point into another institution.
- `pg_safeupdate` in the database and a test that every `UPDATE`/`DELETE` in the migrations has a `WHERE`.
- Server-worker functions (`push_*`, `integration_*`, `sync_begin`, `roster_push`) are callable by `anon` on purpose but refuse unless given the dispatch secret (compared as a SHA-256 hash) or a hashed API key.
- Integration credentials encrypted in the app with `INTEGRATION_ENCRYPTION_KEY`; the database only stores ciphertext.
- Signed QR step tokens, replay window, one record per student per session.
- Database tests for cross-tenant reads and writes, role escalation, privileged functions and SSRF URL checks.

## 6. Problems found

Full detail and fixes are in [03-security-review.md](03-security-review.md). In order of severity:

1. **Critical — legacy prototype role escalation (confirmed live).** In `public.aa_profiles` any signed-in user can update their own `role` to `lecturer` (policy checks only `id = auth.uid()`, and `authenticated` has `UPDATE` on every column). UniAttend code and functions do not use these tables, but they share the same user accounts, and the table holds 24 profiles including student numbers, card barcodes and photos. A fix is prepared in `supabase/legacy/aa-profiles-lockdown.sql` and **needs your approval to run**.
2. **High — the production database is shared with three other apps** (the `aa_*`/`uvn_*` attendance prototype, an `acvosa` units/stakeholders app, and a marketplace with `Products`, `listings`, `orders`, `sellers`), plus two edge functions that are not UniAttend's (`yoco-payment`, `analyse-window`). A flaw in any of them is a flaw in UniAttend's database. Universities will ask about this.
3. **High — the push/integration dispatch secret is the same value as a Supabase secret API key** (`supabase/push-schedule.sql`, not committed). Rotate the key and use an independent random secret.
4. **High — no staging environment and no proven restore.** Free plan, no point-in-time recovery, no restore test.
5. **High — payments not live.** Only a manual billing path works; the Paystack webhook edge function described in migration 0012 is not deployed (0 payments recorded).
6. **Medium** — leaked-password protection off; `pg_net` in `public`; `public.geo_distance_m` (not UniAttend) has a mutable `search_path`; no error monitoring service; no CAPTCHA keys set unless `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is configured.

## 7. Missing capabilities (summary)

- Roles: faculty admin, department admin, attendance officer, integration admin, auditor.
- Attendance: a formal *pending review* state and an exception queue across all check-in failure reasons; "not recorded" as a distinct state.
- Integrations: configurable REST connector (paths, pagination, OAuth, response mapping); versioned public API (`/api/v1/...`) and developer docs; per-key rotation UI; complete-dataset reconciliation rules; source-of-truth policy for timetable conflicts.
- Reporting: faculty and department reports, institution trends, Excel and PDF export, export audit trail.
- Operations: staging, backups and restore test, monitoring and alerts, SMTP, support desk, onboarding checklist, institution exit.
- Mobile: release build, real-device test matrix, FCM push for a closed app.

## 8. Technical debt

- Two generations of integration code: the roster connections (0024, `/admin/connections`) and the sync engine (0025+). Both work; the Integration Centre shows both. They should converge on the engine.
- Several legacy documents (`docs/01-AUDIT.md` … `04-MULTI-UNIVERSITY-AUDIT.md`) overlap with this folder. Treat `docs/commercial-readiness/` and `docs/PLATFORM-BLUEPRINT.md` as current.
- `UniAttend.apk` (a debug build) is committed in the repository root; build artefacts should not be.
- The acoustic attendance tables (`acoustic_windows`, `acoustic_submissions`) remain from an experiment; the brief deprioritises acoustic verification.

## 9. Dependencies on institutional access

| Needed | For |
|---|---|
| A Moodle site and a read-only web-services token | Proving the Moodle connector end to end. |
| ITS / Banner / PeopleSoft export or API access | Any SIS connector. Until then these are listed as "not available yet". |
| CELCAT or the timetable office's export | The `timetable_events` dataset with real data. |
| A pilot department, lecturers and consenting students | Every *Verified* status. |
| The university's Information Officer and legal office | Operator agreement, retention schedule, POPIA sign-off. |
