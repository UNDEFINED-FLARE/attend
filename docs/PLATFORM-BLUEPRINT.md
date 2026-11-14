# UniAttend platform blueprint

Written 14 November 2026, at commit `b851c02` on `main`. This document describes the whole platform: what it is, how it is built, every table, function, policy and file, how to set it up from nothing, and what is unfinished.

**Read this first if you are an AI agent asked to recreate the platform.**

1. **The Git repository is the platform.** If `https://github.com/UNDEFINED-FLARE/attend` (or any copy of it) still exists, clone it and follow section 6. Do not rewrite anything.
2. **If only the database script survives**, `supabase/install-uniattend.sql` recreates the entire database (all 25 migrations in one transaction). The app code would then be rebuilt from this document.
3. **If only this document survives**, it is a specification, not a copy. You can rebuild a platform that behaves the same, using the rules in sections 4 and 7–9 and the inventory in the appendices. It will not be byte-for-byte identical: the SQL function bodies and the page markup are described here, not reproduced. Follow the rebuild order in section 15.

Appendices A–E are generated from the code by `scripts/blueprint-appendix.py`. Rerun it after changing migrations or files so this document stays true.

---

## 1. What UniAttend is

A multi-university attendance platform (software as a service). One deployment serves many institutions, each isolated from the others.

- A **lecturer** opens an attendance session for a module and shows a QR code that changes every 20 seconds.
- A **student** scans it with their phone. The database scores the check-in from three kinds of evidence: the signed QR token, the phone's location relative to the venue, and a privacy-preserving device hash.
- Strong evidence records the student as present (or late). **Weak evidence never becomes an absence automatically: it goes to the lecturer to review.**
- **Institution administrators** manage their own structure, people, timetable, design, policies and data connections.
- A **platform administrator** (super admin) approves institutions, manages plans and billing, and sees no student data by default.

Operating company: **Webbex Solutions (Pty) Ltd**, registration 2026/690092/07, Thohoyandou, Limpopo, South Africa. First pilot institution: University of Venda (UNIVEN). Law that shapes the design: POPIA and PAIA (South Africa).

## 2. Roles

| Role | Scope | Home | Can |
|---|---|---|---|
| `super_admin` | Platform (no institution) | `/super` | Approve, suspend and set up institutions; plans; record payments; platform announcements; see data requests |
| `institution_admin` | One institution | `/admin` | Everything inside their institution: structure, modules, people, timetable, design, policy, data, connections, audit log |
| `lecturer` | Modules they are assigned to | `/lecturer` | Open, control and close sessions; register; late decisions; reviews and disputes; message a class; early warning for their modules |
| `student` | Their own records | `/student` | Check in and out, timetable, map and directions, history, disputes |

A person can hold different roles at different institutions (`user_roles`). The active institution is a cookie preference (`ua_inst`) that is ignored unless the database confirms the role. Roles are granted, never claimed: nothing in sign-up data can set a role.

## 3. Technology

| Layer | Choice |
|---|---|
| Web app | Next.js 15.5 (App Router, React 19, Server Components, Server Actions), TypeScript 5 strict, Tailwind CSS v4 |
| Database, auth, storage | Supabase (Postgres 17, Auth with email confirmation, Storage, pg_cron, pg_net, pgcrypto) |
| Hosting | Vercel (project `attend`, team `blueflare`); production URL `https://attend-git-main-blueflare.vercel.app` |
| Android app | Capacitor 8 shell that loads the deployed site (`mobile/app.json`, `capacitor.config.ts`, `android/`), app id `za.uniattend.app` |
| Validation | zod |
| Maps | Leaflet with OpenStreetMap tiles; OpenRouteService for walking routes; Overpass for building outlines |
| QR | `qrcode` to draw, `html5-qrcode` to scan |
| Push | `web-push` (VAPID); Capacitor Local Notifications in the Android app |
| PDFs | `pdfjs-dist` (timetable import) |
| Tests | Vitest; database tests run the real migrations on PGlite (in-memory Postgres) |

Exact dependency versions are in `package.json` (reproduced in the repository; key ones: next ^15.5.29, react ^19.1.10, @supabase/ssr ^0.7.0, @supabase/supabase-js ^2.58.0, zod ^3.25.76, tailwindcss ^4, vitest ^3.2.4, @electric-sql/pglite ^0.5.10, @capacitor/core ^8.6.0, @capgo/capacitor-native-biometric ^8.9.3, web-push ^4.0.0, leaflet ^1.9.4, pdfjs-dist ^6.4.299, qrcode ^1.5.4, html5-qrcode ^2.3.8).

`next.config.ts`: dev builds go to `.next-dev`, production to `.next`; security headers (nosniff, frame deny, HSTS, permissions policy for camera, geolocation and microphone on self); `serverExternalPackages: ["pdfjs-dist"]`; server action body limit 6 MB. Path alias `@/*` → `src/*`.

## 4. Architecture rules (these are the platform's character; keep all of them)

1. **Everything lives in the Postgres schema `uniattend`**, which must be added to Supabase's exposed schemas. The Supabase project is shared with other apps in `public`; never touch those.
2. **Every institution-owned row has `institution_id`.** Parents have `unique (institution_id, id)` and children use composite foreign keys `(institution_id, parent_id)`, so a row can never point at another institution's parent, even with a forged id.
3. **Row-level security is on for every table.** Tables that nobody should read (`session_secrets`, `push_config`, `integration_secrets`, staging helpers) have RLS on and no policy.
4. **Privileged work happens in `SECURITY DEFINER` SQL functions** with `set search_path = ''`, fully qualified names, an explicit permission check at the top (`is_inst_admin`, `teaches_module`, `is_super_admin`, or a secret), and explicit `revoke`/`grant`.
5. **The service-role key is never used by the web app** and never set in Vercel. The app uses only the anon key plus the user's session.
6. **Server-to-database work without a user** (push sending, sync workers) proves itself with a shared secret, `PUSH_DISPATCH_SECRET`, whose SHA-256 hash is stored in `push_config`. Functions check it with `push_secret_ok()`.
7. **The browser never decides anything.** It sends raw evidence; the database computes scores and statuses.
8. **Nothing is silently deleted.** People and modules are soft-deleted (`deleted_at`); attendance is corrected with an audited override, never erased; syncs never delete.
9. **Supabase has `pg_safeupdate`**: every `UPDATE` and `DELETE` needs a `WHERE` clause, including inside functions.
10. **Migrations are additive and safe to rerun** (`if not exists`, `create or replace`, `drop policy if exists`). They are applied by hand in the Supabase SQL Editor or with `supabase db push`. `npm run bundle:sql` regenerates `supabase/install-uniattend.sql`.
11. **Features degrade gracefully before their migration is applied**: server actions catch PostgREST `PGRST202` (function missing) and `PGRST204`/`42703` (column missing) and say which migration is needed.
12. **Any URL the server fetches for an administrator** goes through `assertPublicHttps` (`src/lib/url-safety.ts`): https only, no credentials in the URL, no private or internal addresses by name or after DNS resolution, re-checked on every redirect, with a timeout and size cap.
13. **Secrets never reach the browser, logs or Git.** `.env*` and `supabase/*.local.sql` are ignored. Connection credentials are encrypted (AES-256-GCM) before storage.
14. **User-facing text is plain English**, short, and says what to do next. Times are shown in `Africa/Johannesburg`.

## 5. Accounts, services and settings

| Thing | Value |
|---|---|
| GitHub | `UNDEFINED-FLARE/attend`, default branch `main` |
| Supabase project | name `uniattend`, ref `rbnnbmduwrvokhbkezyh`, region eu-west-1 (Ireland), free plan at the time of writing |
| Vercel | team `blueflare`, project `attend`; a second, older project `uniattends1` is still linked and always fails |
| Collaborator | Mohamed Patel (co-director) |

Environment variables (Vercel and `.env.local`; never commit values):

| Name | Needed for | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Everything | Public |
| `NEXT_PUBLIC_SITE_URL` | Email links, API docs | Deployment URL |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Phone notifications | `npx web-push generate-vapid-keys` |
| `PUSH_DISPATCH_SECRET` | Push sending and roster sync | 32+ random characters; same value given to the database with `select uniattend.set_push_secret('<value>')`. **Use a random value made for this purpose, never a Supabase API key.** |
| `INTEGRATION_ENCRYPTION_KEY` | Saving connection tokens | 32 random bytes, base64; changing it means re-entering every token |
| `ORS_API_KEY` | Walking directions | Optional |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | CAPTCHA | Optional; turn on in Supabase Auth afterwards |
| `ALERT_WEBHOOK_URL` | Error alerts to chat | Optional |

Supabase dashboard settings: expose schema `uniattend`; keep email confirmation **on**; Site URL and `<site>/auth/callback` redirect; custom SMTP is required for real use (the built-in mailer only reaches the project team).

Scheduled jobs (pg_cron): `uniattend-push` every minute calls `POST <site>/api/push/dispatch` with `Authorization: Bearer <PUSH_DISPATCH_SECRET>` (template in `supabase/push-schedule.sql`; keep the filled-in copy as `*.local.sql`); `uniattend-retention` at 00:30 UTC runs `uniattend.run_retention()`.

## 6. Setting up from the repository

```bash
git clone https://github.com/UNDEFINED-FLARE/attend.git
cd attend
npm install
cp .env.example .env.local   # fill in the Supabase URL and anon key
npm run dev                  # http://localhost:3000
```

1. Supabase → SQL Editor → run the whole of `supabase/install-uniattend.sql` (or apply `supabase/migrations/*.sql` in filename order).
2. Supabase → Settings → API → Exposed schemas → add `uniattend`.
3. Auth: confirm email on; set Site URL and redirect URL; configure SMTP.
4. Sign up in the app, then make yourself platform admin:
   ```sql
   insert into uniattend.profiles (id, email) select id, email from auth.users where email = 'you@example.com' on conflict do nothing;
   insert into uniattend.user_roles (user_id, role) select id, 'super_admin' from auth.users where email = 'you@example.com';
   ```
5. Vercel: import the repo, set the environment variables, deploy.
6. Push and sync: set `PUSH_DISPATCH_SECRET` in Vercel, give the same value to the database (`set_push_secret`), and run `supabase/push-schedule.sql` with the site and secret filled in.
7. Android: `npm run android:build` (debug APK in `android/app/build/outputs/apk/debug/`); release builds need `android/keystore.properties` (see `docs/android-app.md`).

Checks before any commit: `npm run typecheck`, `npm run lint`, `npx vitest run tests --exclude "tests/db/**"`, `npx vitest run tests/db --no-file-parallelism` (database tests are slow and must not run in parallel on a small machine), `npm run build`.

## 7. Data model in words (full column lists are in appendix B)

- **Tenancy and people:** `institutions` (slug, status pending/active/suspended/archived, theme JSON), `institution_settings` (policy: minimum attendance 75%, late after 10 min, accept score 70, GPS radius 60 m, retention 1,095 days, early-warning thresholds), `institution_domains`, `profiles` (one per auth user), `user_roles`, `students` and `lecturers` (register entries; `user_id` is filled when the person signs up with the matching confirmed email).
- **Academic structure:** `faculties` → `departments` → `academic_programmes`; `academic_periods`; `modules` (unique per institution, code and period); `module_enrolments` (active/dropped, `source` = the connection that made it); `lecturer_assignments`; `campuses`; `venues` (point and radius, or polygon outline); `timetables` (weekly slots: weekday, start, end, venue, lecturer, kind).
- **Attendance:** `class_sessions` (scheduled/open/closed/cancelled, join code, opens_at, late_after, closes_at, require_gps, allow_printed_qr), `session_secrets` (HMAC key per session, unreadable), `attendance_records` (one per student per session: present, late, late_pending, absent, excused, pending_verification, disputed; method qr/code/manual/acoustic/system/card/offline; score; explanation; minutes_late; checked_out_at; custom status), `attendance_evidence`, `attendance_verification_events` (every attempt), `attendance_disputes`, `attendance_statuses` (institution-defined labels), `acoustic_windows`/`acoustic_submissions` (optional sound check, off by default).
- **Early warning:** `student_alerts`, `student_alert_events`.
- **Communication:** `announcements` (targeted to all, faculty, department, module, one student or one lecturer; category), `notifications` (per user inbox, `dedupe_key`, `pushed_at`), `push_subscriptions`, `push_config`.
- **Commercial:** `subscription_plans` (starter, professional, enterprise with limits and feature flags), `institution_subscriptions` (trialing/active/past_due/suspended/cancelled, period end), `payments`, `usage_metrics`.
- **Governance:** `audit_logs`, `data_requests`, `theme_versions`, `institution_directory` (seeded South African institutions with campus maps and timetable sources).
- **Integrations:** `integrations`, `integration_secrets`, `integration_runs`, `integration_staging`, `integration_external_ids`, `integration_errors`, `integration_checkpoints`, `integration_seen`, `integration_seen_modules`.

## 8. How each feature works

### 8.1 Sign-up, sign-in and linking
- Email and password (10+ characters) through Supabase Auth; the confirmation link returns to `/auth/callback`. Sign-in is a server action; cookies last 400 days, or the browser session when "Keep me signed in" is unticked (`ua_session_only`).
- `link_my_accounts()` runs after sign-in: it attaches the user to student and lecturer register entries whose email matches (or whose student number matches the email's local part on a verified domain), **only in active institutions and only for confirmed emails**, creates the role, and notifies the person. `leave_institution()` lets them leave; an admin cannot add them back.
- `middleware.ts` refreshes the session on every request and redirects signed-out visitors to `/login`, except public paths (`/`, `/login`, `/signup`, `/forgot-password`, `/auth/callback`, `/privacy`, `/terms`, `/paia`, `/api/push/`, `/api/health`, `/api/roster`). `?i=<slug>` on auth pages sets the `ua_brand` cookie so the sign-in page wears that institution's branding.
- Optional Cloudflare Turnstile token is passed to Supabase Auth (`src/components/captcha.tsx`).

### 8.2 Sessions and the QR code
- `open_session(module, venue, title, minutes, late_minutes)`: lecturer of the module or admin; institution must be able to operate (active, with a live trial or subscription); creates a 6-character join code and a random secret.
- QR token = `<step>.<22-character signature>`, where `step = floor(epoch / 20)` and the signature is the first 22 base64url characters of `HMAC-SHA256("<session id>:<step>", secret)`. The current and previous step are accepted, so a token lives 20–40 seconds. The QR encodes a link `/student/check-in?s=<session>&t=<token>`.
- Printed QR (optional, only when the session requires GPS): fixed token `P.<signature for step -1>`; regenerating the key cancels it.
- `session_control`: pause, resume, regenerate key and code, printed on/off, change the window. `close_session`: late arrivals not denied become late; everyone without a record becomes absent; the secret is deleted.

### 8.3 Check-in scoring (`check_in`)
Order: find the session (by id or typed code among the student's own modules) → confirm student, role and enrolment → session open → institution can operate → rate limit (5 attempts per minute) → duplicate check → score:

| Layer | Max | Rule |
|---|---|---|
| Session proof | 40 | Valid live QR 40; typed code 15 (if allowed); otherwise rejected with no record |
| Location | 40 | Only when the session requires GPS. Weighted mean of up to 20 samples; signed distance to the venue polygon or circle; `points = 40 × 1/(1+exp(1.7 × distance / max(4, accuracy × 0.6)))`; capped at 8 when accuracy is worse than the institution's limit; capped at 10 for suspiciously uniform readings; not shared = 0 |
| Device | 20 | 20 normally; 10 with no hash or a device used by several students recently; 0 if the same device already checked in another student in this session |

`score = round(100 × earned / possible)`. At or above `accept_score` (70): `present`, or `late_pending` if after the grace period (the lecturer decides; undenied becomes `late` at close). Below: `pending_verification` for the lecturer. Only the distance and accuracy are stored, never coordinates. Every attempt is logged, evidence is stored per layer, and the student gets a notification.

`check_in_offline` (migration 0020): evidence captured without signal is sent later with its original time; always `pending_verification`; the QR is checked against the 20-second window it was shown in while the session is open; refused if in the future, outside the session window or older than 48 hours; never changes a lecturer's decision.

### 8.4 Register, late arrivals, disputes, check-out, card scanning
- `save_register(session, entries, note)`: bulk present/late/absent/excused plus custom status, with history (`record_history`).
- `decide_late`: accept or deny late arrivals, reversible.
- `override_attendance`, `submit_dispute`, `resolve_dispute`: corrections with a note, evidence and a notification.
- `check_out` and `scan_student(session, code, direction)`: card or barcode scans in and out; leaving more than 10 minutes early is marked.
- Student live class screen (`/student/class/[id]`) with a countdown; timetable download as `.ics`.

### 8.5 Timetable, map and venues
- Weekly slots per module; imported from a PDF, a document, or the institution's timetable source (`src/lib/timetable-sources.ts`: `viewer_json`, `pdf_links`, `pdf_url`), set per institution by the platform admin.
- Campus maps with venue points or outlines; `outline-all` fetches building footprints from OpenStreetMap (Overpass) and matches them to venues by name. "Find my class" gives walking directions (`/api/route` proxies OpenRouteService with no identity).

### 8.6 Notifications
- Database triggers and functions insert into `notifications`. Every minute the dispatch route calls `push_claim(secret)`, which also queues class reminders 15 minutes before a timetable slot, and sends Web Push to each subscribed device respecting its preferences (classes, announcements, attendance). `public/sw.js` shows them and handles clicks. The Android app schedules local reminders from the timetable.
- Admin announcements can target everyone, a faculty, a department, a module, one student or one lecturer (`fan_out_announcement`); lecturers message a class with `send_class_message` (20 per hour).

### 8.7 Design, branding and themes
- `institutions.theme` is JSON validated by `ThemeSchema` (`src/lib/theme.ts`): light palette, `appearance` (light, dark or follow the device, with a dark palette), shape, font, header, sidebar, footer, announcement banner, `login` text, feature switches, menus per role, and student home cards. `parseTheme` merges over defaults section by section so a bad value never breaks a page. `themeStyle` emits CSS variables (`--brand`, `--accent`, `--bg`, `--surface`, `--ink`, `--muted`, `--ok`, `--warn`, `--bad`, `--line`, radii, font); for "follow the device" it also emits `--d-*` and `globals.css` swaps them in under `prefers-color-scheme: dark`.
- Default look: minimal graphite (primary `#2d2f33`, accent `#45484d`, background `#e7e8ea`, surface `#f5f5f6`, text `#1d1e20`, muted `#6b6e74`, success `#3d7a55`, warning `#9a6a1f`, danger `#a8443d`), rounded corners, system font, soft raised cards.
- Admin Design page: live preview (desktop, phone, sign-in), presets, save draft, publish with a note, 30 versions of history, logo upload to Storage bucket `branding/<institution id>/…` (PNG, JPEG or WebP, 512 KB, checked by file signature).
- `public_branding(key)` gives the sign-in pages an institution's name, logo, colours and sign-in text before anyone signs in.

### 8.8 App lock and offline
- App lock (`src/lib/app-lock.ts`, `src/components/app-lock.tsx`, `/settings`): per device; Android uses the phone's biometric prompt, browsers use a platform passkey with user verification; "Use my password instead" signs out; no biometric data ever reaches the server.
- Offline (`src/lib/offline-queue.ts`, `src/components/offline-sync.tsx`): check-ins and register marks are queued in localStorage per user and sent when back online; the service worker caches the app's static files and the last copy of signed-in pages.

### 8.9 Early warning
Alerts when a student's attendance in a module falls below its minimum, or after consecutive absences (defaults: 3 sessions minimum, 3 in a row). Staff acknowledge, contact, resolve; history is kept (migration 0015).

### 8.10 Billing
Plans with limits enforced by triggers (`enforce_plan_limits`). New institutions get a 30-day Starter trial; attendance stops when a trial or subscription ends (`institution_can_operate`). The platform admin changes plans or records an EFT payment (`record_manual_payment`); admins are warned 14 days before the end (`subscription_notice`). A Paystack webhook edge function exists in `supabase/functions/paystack-webhook` but is not deployed.

### 8.11 Data governance
`retention_preview`, `apply_retention`, optional nightly `run_retention`; `my_personal_data()` behind "Download my data"; `data_requests` with a 30-day clock for the person's institution admins and the platform admin. Legal pages: `/privacy`, `/terms`, `/paia`, with company details from `src/lib/legal.ts`. Internal policies in `docs/legal/`.

### 8.12 Integrations and the sync engine
- **Connections** (`/admin/connections`, migration 0024): `moodle` (reads courses and enrolled users through Moodle web services: `core_webservice_get_site_info`, `core_course_get_courses`, `core_enrol_get_enrolled_users`), `feed` (a CSV or JSON roster at an https link), `api` (the institution's system posts to `/api/roster` with a key `ua_<48 hex>` stored as a hash), and file upload. The roster shape is `{ modules: [{code,title}], people: [{role, number, full_name, email, module_codes}] }`.
- The worker (`src/lib/integrations/runner.ts`) runs from the every-minute dispatch route: `integration_claim(secret)` hands over one due connection with its encrypted token; large Moodle sites are read a few courses per call with a saved position; failures retry hourly and notify admins.
- **Engine** (migration 0025): rows are staged per dataset (`faculties`, `departments`, `programmes`, `academic_periods`, `venues`, `modules`, `lecturers`, `students`, `enrolments`, `assignments`), validated, matched by the source's external id first and then the natural key, previewed by running the real commit and rolling it back, and committed atomically. Statuses change only from explicit values; a complete roster from a connection may drop that connection's own enrolments, held back if more than half (and more than 20) would go. Admin path: `import_start`, `import_add`, `import_preview`, `import_commit`, `import_cancel`. Worker path: `sync_begin`, `sync_stage`, `sync_commit`, `sync_fail`. Connection status is set only by `integration_test_result` after a real test.

## 9. User interface

- **Shell** (`src/components/shell.tsx`): desktop sidebar plus top bar; phones get a bottom tab bar; students get an app-like layout with a floating tab bar and a raised scan button. Menus come from `src/lib/nav-config.ts` and the theme.
- **Components** (`src/components/ui.tsx`, `form.tsx`): `Button`, `LinkButton`, `Card`, `CardTitle`, `Field`, `Input`, `Select`, `Textarea`, `Badge`, `Stat`, `Table`, `Td`, `Notice`, `PageHeader`, `ActionForm` (a form bound to a server action that shows its error or success), `Submit`.
- **Pattern for every page:** a server component calls `requireRole(...)`, loads data with the user's Supabase client (RLS decides what comes back), and renders; mutations are server actions that validate with zod, call an RPC or a table write, `revalidatePath`, and return `{ error }` or `{ ok }`.
- All routes are listed in appendix E under `src/app/`.

## 10. Routes at a glance

- Public: `/`, `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/privacy`, `/terms`, `/paia`.
- Any signed-in user: `/dashboard` (redirects by role), `/onboarding`, `/notifications`, `/settings` (app lock, institutions, my data).
- Student: `/student`, `/student/check-in`, `/student/class/[id]`, `/student/timetable` (+ `calendar.ics`), `/student/map`, `/student/navigate`, `/student/history`.
- Lecturer: `/lecturer`, `/lecturer/modules/[id]` (+ `export`), `/lecturer/sessions/[id]` (+ `print`, `scan`), `/lecturer/timetable` (+ `calendar.ics`), `/lecturer/disputes`, `/lecturer/early-warning`.
- Admin: `/admin`, `/admin/data` (+ `export`), `/admin/structure`, `/admin/modules`, `/admin/timetable`, `/admin/people`, `/admin/connections`, `/admin/early-warning`, `/admin/design`, `/admin/settings`, `/admin/requests`, `/admin/audit`.
- Platform: `/super`, `/super/institutions/[id]`, `/super/directory` (+ `[id]`), `/super/plans`, `/super/requests`.
- API: `/api/push/dispatch` (secret), `/api/roster` (API key), `/api/route` (walking directions), `/api/health`, `/auth/callback`.

## 11. Tests

- `tests/db/*.test.ts` build a database from the real migrations (`tests/db/harness.ts` provides `db.as(user, sql, params)` running as `authenticated`, or `anon` when the user is null; `db.admin`; `db.asService`; `db.newUser`). Fixtures: two institutions, A and B, each with an admin, a lecturer, three students and module `CSC101`. Suites cover roles, tenant isolation, the attendance engine, late arrivals, disputes, plans, timetables, push, the register, check-in controls, announcements, design, offline check-ins, membership consent, billing, retention and data requests, roster sync and the sync engine.
- `tests/unit/*.test.ts` cover pure logic: CSV, timetable parsing, geometry, theme, roster mapping, encryption.
- 210 tests at the time of writing (122 database, 88 unit).

## 12. Conventions

- Comments explain why, in plain words. No dead code.
- Server-only modules start with `import "server-only"`.
- New database behaviour = a new numbered migration `YYYYMMDD0000NN_name.sql` with a header comment explaining it, plus tests, then `npm run bundle:sql`.
- Commits happen only when the owner asks; the owner's working copy of `supabase/push-schedule.sql` is never committed.
- Temporary preview pages (`src/app/dev-*`) may be added to the public list while checking a screen and must be removed before committing.

## 13. State at the time of writing

**Live database:** migrations 0001–0023 are applied. **Not yet applied: 0024 (integrations) and 0025 (sync engine).** `INTEGRATION_ENCRYPTION_KEY` is not yet set in Vercel.

**Live data:** 3 institutions (UNIVEN, UL, TUT), all on Starter trials ending 8–9 December 2026; 21 students, 5 lecturers, 724 modules (11 with a lecturer, 5 with students).

**Not done or not verified:**
- Integration brief phases B–F: Import Centre with column mapping and preview screens; Integration Centre dashboard, provider catalogue and setup wizard; configurable REST connector with OAuth, and a clearly labelled mock ITS connector; dated timetable events with cancellations; platform integrations view. No connector has been tested against a real Moodle, ITS, CELCAT, Banner, PeopleSoft or Blackboard.
- The extra roles from the multi-university brief (faculty admin, department admin, attendance officer, auditor) do not exist.
- Hosting is on Supabase's free plan, shared with other apps; no backups; custom SMTP not configured; CAPTCHA and error alerts not switched on.
- Load tests in `loadtest/` have never been run. Fingerprint unlock and offline check-ins are untested on real phones. Android has only a debug build; no Firebase push for the closed app.
- Legal: head of company and Information Officer not chosen; attorney review outstanding (`docs/legal/README.md`).
- The old prototype tables `public.aa_*` in the same Supabase project are not part of UniAttend and have a hole (any signed-in user can make themselves a lecturer there).

## 14. Other documents in the repository

`README.md` (setup), `docs/01-AUDIT.md`, `docs/02-ROADMAP.md`, `docs/03-PLATFORM-AUDIT-AND-ROADMAP.md`, `docs/04-MULTI-UNIVERSITY-AUDIT.md`, `docs/capacity/10k-readiness-report.md`, `docs/android-app.md`, `docs/notifications.md`, `docs/guide-admin.md`, `docs/guide-lecturer.md`, `docs/guide-student.md`, `docs/legal/*`.

## 15. Rebuild order (only if the repository is lost)

1. Create a Next.js 15 App Router project with TypeScript strict and Tailwind v4; add the dependencies in section 3; copy the config in section 3.
2. Recreate the database. With `install-uniattend.sql`: run it. Without it: write migrations in the order of appendix A, creating the tables of appendix B, the policies of appendix C and the functions of appendix D, following the rules in section 4 and the behaviour in section 8. Write the database tests of section 11 as you go; isolation tests first.
3. Supabase clients (`src/lib/supabase/`): browser client, server client with 400-day or session cookies, `getUserWithRetry`. Then `src/lib/auth.ts` (`getSession`, `requireRole`) and `middleware.ts`.
4. Theme (`src/lib/theme.ts`, `globals.css`), UI components, shell and navigation.
5. Auth pages, onboarding (`request_institution`), dashboard redirect.
6. Platform admin: institutions, approval, directory, plans.
7. Institution admin: structure and map, modules, people and imports, timetable, settings.
8. Lecturer: sessions with the live QR, register, late decisions, disputes.
9. Student: check-in with evidence collection, live class, history, timetable, map.
10. Notifications and push; announcements and class messages.
11. Design page, branding, app lock, offline queue.
12. Early warning, billing notices, data governance and legal pages.
13. Connections, the sync engine and (remaining) the Integration Centre.
14. Android shell with Capacitor.

After each step: type-check, lint, tests, build.

---

<!-- GENERATED-APPENDIX: everything below is rewritten by scripts/blueprint-appendix.py -->

# Appendices (generated from the code)

## A. Migrations (in order) and what each does

### `20261107000001_core.sql` (310 lines)

> UniAttend 0001 — tenancy, academic structure, people, roles.
>
> Tenant consistency rule: every institution-owned table carries institution_id,
> and every parent it references is referenced through (institution_id, id). A
> module therefore cannot point at another institution's department even if a
> bug or a hostile client supplies a foreign id: the composite FK rejects it.

### `20261107000002_attendance.sql` (146 lines)

> UniAttend 0002 — attendance sessions, records, verification and disputes.

### `20261107000003_saas.sql` (110 lines)

> UniAttend 0003 — commercial layer, notifications, announcements, audit.

### `20261107000004_rls.sql` (220 lines)

> UniAttend 0004 — authorization predicates and row level security.
>
> Predicates are SECURITY DEFINER so evaluating a policy on one table does not
> re-enter RLS on another and recurse, and they pin search_path to '' (an
> unpinned search_path on a definer function is a privilege-escalation vector).
> Identity always comes from auth.uid(); no predicate takes a user id argument.

### `20261107000005_functions.sql` (1011 lines)

> UniAttend 0005 — server-side business logic.
>
> Rule: no function accepts a user id, role, institution id-as-authority, or a
> desired attendance status from a student. Identity comes from auth.uid();
> institution comes from the row being acted on; status is computed here.

### `20261108000006_fix_import_safeupdate.sql` (72 lines)

> UniAttend 0006 — fix: adding students failed on Supabase with
> "UPDATE requires a WHERE clause". Supabase loads pg_safeupdate for API
> requests, which rejects an UPDATE with no WHERE even inside a function, and
> import_students() validated rows with one. Same function, plus that WHERE.
> CREATE OR REPLACE keeps the function's owner and EXECUTE grants.

### `20261109000007_timetables_scale.sql` (117 lines)

> UniAttend 0007 — timetables, venue clash protection, and scale.
>
> * Timetable slots get a kind (lecture/tutorial/...) and an optional group.
> * A venue cannot be double-booked: overlapping slots in the same venue on
> the same weekday are rejected with a message naming the clash.
> * Indexes for the queries dashboards run at large-institution volume.
> * institution_dashboard(): every dashboard figure computed in one SQL call,
> instead of shipping thousands of rows to the web server.

### `20261109000008_timetable_details.sql` (35 lines)

> UniAttend 0008 — details carried over from timetable imports, and admin control.
>
> * venues.building: the building a room is in ("E-BLOCK"), so rooms can be
> placed on the campus map together.
> * modules.expected_students: class size from the university timetable.
> * timetables.lecturer_id: who teaches each class, shown to students.
> * lecturers.source: where a lecturer record came from ('timetable' for ones
> created from an import, so admins can review them).

### `20261109000009_institution_setup.sql` (84 lines)

> UniAttend 0009 — institution-neutral setup: campus maps and timetable sources
> per institution, and a platform directory of known institutions.
>
> * campuses: an outline and zoom so each institution's map opens on its own
> campuses (nothing about any institution is hard-coded in the app).
> * institution_settings: where the institution's timetable is collected from.
> * institution_directory: the super admin's catalogue of known institutions,
> their campus locations and timetable links, applied to an institution in
> one step when it registers. Only the super admin can see or change it.

### `20261109000010_late_arrivals.sql` (331 lines)

> UniAttend 0010 — late arrivals: the lecturer has the final say.
>
> After the grace period, a check-in that passes the QR/location/device checks is
> recorded as 'late_pending' (shown grey: arrived, awaiting the lecturer) together
> with how many minutes after the grace period the student arrived. The lecturer
> accepts (-> late, counts as attended) or denies (-> absent). Anything still
> undecided when the session closes is accepted.

### `20261109000011_push_notifications.sql` (229 lines)

> UniAttend 0011 — phone notifications.
>
> Every notification row (attendance open, check-in results, late decisions,
> corrections, disputes) can now also be pushed to the person's phone or browser.
> New sources of notifications:
> * class reminders, queued shortly before each timetabled class;
> * announcements, fanned out to their audience when published.
> A sender (the app's /api/push/dispatch, called every minute by pg_cron) claims
> unsent notifications with a shared secret and delivers them with Web Push.

### `20261110000012_security_hardening.sql` (95 lines)

> 0012 — security review fixes (2026-11-10), on top of the uniattend schema.
>
> 2. (app code) open redirect after sign-in / email links: see src/lib/safe-redirect.ts
> 3. grant_role only targets accounts with a confirmed email, matching
> link_my_accounts, so a pre-registered (squatted) address cannot receive a role.
> 4. apply_paystack_payment: claims the payment and extends the subscription in
> one transaction, so concurrent webhook deliveries apply a payment once.
> (Fix 1 from the review, explicit table grants, is already covered here by the
> uniattend schema and its default privileges in 0001.)
> --------------------------------------------- 3. confirmed accounts only

### `20261110000013_campus_location_sharing.sql` (207 lines)

> 0013 — campus location sharing and class navigation (2026-11-10)
>
> Location is personal information under POPIA. The design keeps it minimal:
> * Off until the institution enables it AND the student gives consent.
> * Only the LATEST position is kept: one row per student, no history.
> * The row is deleted as soon as the student is off campus (unless they
> turned on safety sharing themselves), stops sharing, or withdraws consent.
> Positions not refreshed for 12 hours are purged.
> * Only the student and their own institution's admins can read it.
> * Nobody writes the table directly; report_location() decides on/off campus
> on the server, so a modified app cannot keep sharing off campus silently.

### `20261111000014_attendance_register.sql` (166 lines)

> UniAttend 0014 — the lecturer's register: configurable statuses, bulk save, change history.
>
> * attendance_statuses: an institution's own statuses ("Left early", "Medical",
> "Field trip"...), each with a colour and a CATEGORY that decides how it counts:
> present/late → attended, absent → absent, excused → left out of the percentage.
> Records keep the category in attendance_records.status, so every existing
> report, dashboard and percentage keeps working unchanged.
> * save_register(): the lecturer saves many students at once, in one transaction.
> * Every manual change keeps its history (from, to, who, when, why) in
> attendance_evidence; record_history() returns it.

### `20261111000015_early_warning.sql` (352 lines)

> UniAttend 0015 — early warning: automatic attendance alerts with case follow-up.
>
> What attendance platforms such as SEAtS and Edusign sell as "early alerts":
> * An alert opens when a student's attendance in a module falls below the
> required percentage (worst case, the same rule as module_report().at_risk),
> or when they miss several classes in a row. The student is notified, and the
> module's lecturers and the institution's admins see it.
> * Staff follow it up as a case: open → contacted → resolved / dismissed, with
> notes, an assignee and a full history (student_alert_events).
> * Alerts re-check by themselves when a class closes or a record is corrected,
> and close by themselves when attendance recovers, the student attends again,
> or the student is no longer enrolled.
> * Students never see the case or its notes, only their own notification.
> * Nobody writes the tables directly: only the functions below do.

### `20261111000016_checkin_controls.sql` (213 lines)

> UniAttend 0016 — check-in controls, printed QR, card scanning and check-out.
>
> * Printed QR: a FIXED code for a session, for printing or showing without a
> laptop. A fixed code can be photographed and shared, so it is only accepted
> when the session requires GPS (the location check does the real work), and
> regenerating the session's key cancels it.
> * Controls: pause/resume check-in, regenerate the QR key and join code, change
> the check-in window.
> * Card scanning: a lecturer or scan station reads a student card (barcode or
> QR holding the student number) and records the student in or out.
> * Check-out: card scan or the student's own "I'm leaving"; time present is
> kept, and leaving more than 10 minutes before the end marks "Left early".

### `20261111000017_remove_location_sharing.sql` (18 lines)

> UniAttend 0017 — remove campus live location sharing (added in 0013).
>
> PERMANENTLY deletes every stored live position and every location-sharing
> consent record, and the functions and settings behind them.
> Kept from 0013: campus boundaries and my_next_classes() for "Find my class",
> which uses the student's position only on their own phone and stores nothing.

### `20261112000018_targeted_notifications.sql` (176 lines)

> UniAttend 0018 — targeted announcements and lecturer messages to a class.
>
> * Announcements can target everyone, one faculty, one department, one module,
> one student or one lecturer, and carry a category (general, academic, system,
> class cancelled, venue change, class reminder, timetable change).
> * Lecturers message the students of a module they teach (send_class_message),
> rate-limited; admins target anything in their institution.
> * Recipients get a notification (and a push, following their device settings:
> class updates follow "class reminders", others "announcements").
> * Announcements aimed at a group or a person are no longer readable by every
> member of the institution; only staff who manage them see the table.

### `20261112000019_theme_versions_branding.sql` (156 lines)

> UniAttend 0019 — design drafts, version history, branded sign-in and logo upload.
>
> * theme_versions: an institution's unpublished draft (one at most) and every
> published design (the newest 30 are kept), so admins can work on a design
> without everyone seeing it, and go back to an earlier one.
> * save_theme_draft / discard_theme_draft / publish_theme: the only way to
> write them; admins of that institution only, audited.
> * public_branding(key): the name, logo, colours and sign-in text of one
> institution, readable before signing in so the sign-in page carries the
> institution's look. Nothing else about the institution is exposed.
> * Storage bucket "branding" for uploaded logos (PNG, JPEG or WebP, 512 KB),
> public to read; only an institution's admins write in its own folder.

### `20261112000020_offline_checkin.sql` (203 lines)

> UniAttend 0020 — check-ins made without signal.
>
> A phone with no signal keeps the evidence it collected at the moment of the
> check-in (the QR it scanned or the code typed, location samples, device check
> and the time) and sends it when it is back online. check_in_offline() never
> accepts such a check-in by itself: it goes to the lecturer as "pending review"
> with a plain explanation, and keeps the original time.
>
> * While the session is still open, the QR is checked against the 20-second
> window it was shown in: proof the student saw the live code at that time.
> * After the session closed, the QR key is gone, so it can't be checked; the
> lecturer is told so. An automatic "absent" becomes "pending review"; a
> lecturer's own decision is never changed.
> * Sent within 48 hours of the check-in, for a time inside the session window.

### `20261113000021_membership_consent.sql` (156 lines)

> UniAttend 0021 — nobody is added to an institution without it being approved,
> without being told, and without a way out.
>
> * Accounts are linked to student/lecturer records (by confirmed email) only in
> ACTIVE institutions. Anyone can apply for an institution and administer it
> while it is pending; until the platform approves it, it can't attach other
> people's accounts. grant_role likewise needs an active institution.
> * Whoever is added gets a notification naming the institution and role.
> * leave_institution(): a person removes their own membership. The institution's
> admins can't add them back (grant_role / set_role_status refuse); only the
> platform administrator can, e.g. after the person asks.

### `20261113000022_manual_billing.sql` (69 lines)

> UniAttend 0022 — invoicing by hand, and warning before access runs out.
>
> * record_manual_payment(): the platform administrator records an invoice paid
> by EFT (amount, reference, months). It is kept in payments (provider
> 'manual'), the subscription becomes active and is extended from whichever is
> later, today or its current end. Audited. Same reference twice is refused.
> * subscription_notice(): what an institution's own admins see: plan, status,
> end date, days left and whether attendance is running, so a trial or paid
> period never ends without warning.

### `20261113000023_data_governance.sql` (236 lines)

> UniAttend 0023 — keeping personal information no longer than needed, and
> letting people see and ask about what is held about them (POPIA ss 14, 23–25).
>
> * Retention: each institution already sets retention_days (default 3 years).
> retention_preview() shows what is older than that; apply_retention() deletes
> it (institution admins, audited); with auto_retention on, run_retention()
> does it every night. Off by default: the institution, as the responsible
> party, decides when its records are deleted.
> Deleted: closed/cancelled sessions older than the period (with their
> attendance records, evidence, check-in events and disputes), stray check-in
> events, notifications, announcements, resolved early-warning alerts, audit
> entries, and student records removed from the register before the cut-off.
> Lecturers removed before the cut-off are anonymised (their sessions stay).
> * my_personal_data(): everything UniAttend holds about the signed-in person,
> as one JSON document they can download.
> * data_requests: a person asks for deletion, correction or objects; the
> platform administrator and the person's institution admins see it and record
> the outcome.

### `20261113000024_integrations.sql` (564 lines)

> UniAttend 0024 — collecting students, lecturers, modules and enrolments automatically.
>
> An institution connects its own systems once, and UniAttend keeps its register
> in step with them:
> moodle — reads courses and the people enrolled in them from the institution's
> Moodle through its web-service API (a read-only token);
> feed   — reads a roster file (CSV or JSON) from an https link the student
> system publishes, on a schedule;
> api    — the institution's system pushes the roster to UniAttend with an API key.
> Plus import_roster(): the same roster uploaded by hand by an administrator.
>
> Rules, enforced here rather than in the app:
> * A connection belongs to one institution; only its admins see or change it.
> * Tokens and keys are write-only: stored in integration_secrets, which nobody can
> read (no policy). The token is handed only to the server worker that holds the
> dispatch secret; API keys are stored as a SHA-256 hash and shown once.
> * A sync adds and updates; it never deletes a student, lecturer or attendance
> record. With "drop_missing" on, it marks as dropped only enrolments that the
> same connection created, only after a complete run, and never more than half
> of them at once (a broken or empty feed can't empty the register).
> * People still get access only by signing up with their own confirmed email
> (0021): a sync creates register entries, not accounts.
> * Trials may import in bulk, so an institution can evaluate with real class lists.

### `20261114000025_sync_engine.sql` (856 lines)

> UniAttend 0025 — the academic data synchronisation engine.
>
> Every source (a file upload, a roster link, Moodle, a university's own API,
> later ITS/CELCAT/Banner/PeopleSoft through configurable connectors) is turned
> into rows of a common shape per dataset and goes through the same steps:
>
> stage → validate → match → preview → commit → report
>
> * integration_staging: rows waiting to be applied, per run. Admins of the
> institution can read them (to preview); nobody writes them directly. Deleted
> when the run ends, so source payloads are not kept.
> * integration_external_ids: the source system's own id for each record, scoped
> to institution + source + entity. Matching uses it first, then the natural key
> (student number, staff number, module code…), so renumbering at the source
> updates the same record instead of creating a new one.
> * Preview runs the real commit inside a subtransaction and rolls it back, so the
> preview and the import can never disagree.
> * Commit applies one run atomically: either the whole run lands or none of it.
> * Never deletes. Students and lecturers change status only from an explicit
> status in the source. Enrolments are dropped only from an explicit status, or
> by a complete reconciliation of the same source, guarded against mass removal.
> * integration_errors: rejected rows with the reason (no payload). Kept with the run.
> * integration_checkpoints: where an incremental sync got to, per dataset.
> * Connection status: changed only by a real test made by the server (dispatch
> secret), so an administrator can't mark a connection "connected" by hand.
>
> Datasets: faculties, departments, programmes, academic_periods, venues, modules,
> lecturers, students, enrolments, assignments. (Class sections and dated timetable
> events follow in a later migration.)

### `20261114000026_import_mappings.sql` (35 lines)

> UniAttend 0026 — saved column mappings for imports.
>
> An institution's files rarely use UniAttend's field names (STUDENT_NO, not
> student_number). An administrator maps the columns once on the Import page and
> the mapping is remembered per institution and dataset, so the next file with
> the same layout needs no work. A mapping holds column names and tidy-up rules
> only: no data from any file.

## B. Tables (schema `uniattend`) and their columns

- **academic_periods**
  - `id` uuid primary key default gen_random_uuid()
  - `institution_id` uuid not null references uniattend.institutions(id) on delete cascade
  - `name` text not null
  - `kind` text not null default 'semester' check (kind in ('year','semester','term','block'))
  - `starts_on` date not null
  - `ends_on` date not null
  - `is_current` boolean not null default false
  - `created_at` timestamptz not null default now()
  - `updated_at` timestamptz not null default now()
  - _unique (institution_id, id)_
  - _unique (institution_id, name)_
  - _check (ends_on > starts_on)_
- **academic_programmes**
  - `id` uuid primary key default gen_random_uuid()
  - `institution_id` uuid not null references uniattend.institutions(id) on delete cascade
  - `department_id` uuid not null
  - `name` text not null
  - `code` text not null
  - `created_at` timestamptz not null default now()
  - `updated_at` timestamptz not null default now()
  - `deleted_at` timestamptz
  - _unique (institution_id, id)_
  - _unique (institution_id, code)_
  - _foreign key (institution_id, department_id) references uniattend.departments(institution_id, id)_
- **acoustic_submissions**
  - `window_id` uuid not null references uniattend.acoustic_windows(id) on delete cascade
  - `user_id` uuid not null references auth.users(id) on delete cascade
  - `hash_count` int not null
  - `hashes` int[] not null
  - `offsets` int[] not null
  - `received_at` timestamptz not null default now()
  - _primary key (window_id, user_id)_
- **acoustic_windows**
  - `id` uuid primary key default gen_random_uuid()
  - `institution_id` uuid not null references uniattend.institutions(id) on delete cascade
  - `session_id` uuid not null
  - `idx` int not null
  - `seconds` int not null default 5 check (seconds between 3 and 15)
  - `nonce` text not null
  - `opens_at` timestamptz not null default now()
  - `closes_at` timestamptz not null
  - `analysed_at` timestamptz
  - `cluster_size` int not null default 0
  - `lecturer_bound` boolean not null default false
  - _unique (session_id, idx)_
  - _unique (institution_id, id)_
  - _foreign key (institution_id, session_id) references uniattend.class_sessions(institution_id, id) on delete cascade_
- **announcements**
  - `id` uuid primary key default gen_random_uuid()
  - `institution_id` uuid references uniattend.institutions(id) on delete cascade, -- null = platform-wide
  - `title` text not null
  - `body` text not null
  - `audience` text not null default 'all' check (audience in ('all','students','lecturers','admins'))
  - `published_at` timestamptz not null default now()
  - `expires_at` timestamptz
  - `created_by` uuid references auth.users(id) on delete set null
  - `created_at` timestamptz not null default now()
  - `target_kind` text not null default 'all' check (target_kind in ('all' _(added later)_
  - `target_id` uuid _(added later)_
  - `category` text not null default 'announcement' check (category in ('announcement' _(added later)_
  - `sender_name` text _(added later)_
- **attendance_disputes**
  - `id` uuid primary key default gen_random_uuid()
  - `institution_id` uuid not null references uniattend.institutions(id) on delete cascade
  - `record_id` uuid not null
  - `student_id` uuid not null
  - `reason` text not null check (length(trim(reason)) between 10 and 2000)
  - `status` text not null default 'open' check (status in ('open','upheld','rejected'))
  - `previous_status` text not null
  - `resolved_by` uuid references auth.users(id) on delete set null
  - `resolution_note` text
  - `created_at` timestamptz not null default now()
  - `resolved_at` timestamptz
  - _foreign key (institution_id, record_id) references uniattend.attendance_records(institution_id, id) on delete cascade_
  - _foreign key (institution_id, student_id) references uniattend.students(institution_id, id) on delete cascade_
- **attendance_evidence**
  - `id` uuid primary key default gen_random_uuid()
  - `institution_id` uuid not null references uniattend.institutions(id) on delete cascade
  - `record_id` uuid not null
  - `kind` text not null check (kind in ('qr','gps','device','acoustic','manual'))
  - `data` jsonb not null
  - `created_at` timestamptz not null default now()
  - _foreign key (institution_id, record_id) references uniattend.attendance_records(institution_id, id) on delete cascade_
- **attendance_records**
  - `id` uuid primary key default gen_random_uuid()
  - `institution_id` uuid not null references uniattend.institutions(id) on delete cascade
  - `session_id` uuid not null
  - `module_id` uuid not null
  - `student_id` uuid not null
  - `status` text not null check (status in
  - `method` text not null default 'qr' check (method in ('qr','code','manual','acoustic','system'))
  - `score` int check (score between 0 and 100)
  - `checked_in_at` timestamptz
  - `device_hash` text check (device_hash is null or device_hash ~ '^[0-9a-f]{64}$')
  - `explanation` jsonb not null default '[]'::jsonb
  - `overridden_by` uuid references auth.users(id) on delete set null
  - `overridden_at` timestamptz
  - `override_note` text
  - `created_at` timestamptz not null default now()
  - `updated_at` timestamptz not null default now()
  - _unique (session_id, student_id)_
  - _unique (institution_id, id)_
  - _foreign key (institution_id, session_id) references uniattend.class_sessions(institution_id, id) on delete cascade_
  - _foreign key (institution_id, module_id) references uniattend.modules(institution_id, id) on delete cascade_
  - _foreign key (institution_id, student_id) references uniattend.students(institution_id, id) on delete cascade_
  - `minutes_late` int check (minutes_late is null or minutes_late between 0 and 1440) _(added later)_
  - `custom_status_id` uuid _(added later)_
  - `checked_out_at` timestamptz _(added later)_
- **attendance_statuses**
  - `id` uuid primary key default gen_random_uuid()
  - `institution_id` uuid not null references uniattend.institutions(id) on delete cascade
  - `name` text not null check (length(trim(name)) between 2 and 40)
  - `color` text not null default '#64748b' check (color ~ '^#[0-9a-fA-F]{6}$')
  - `description` text check (description is null or length(description) <= 200)
  - `category` text not null check (category in ('present','late','absent','excused'))
  - `sort_order` int not null default 100
  - `active` boolean not null default true
  - `created_at` timestamptz not null default now()
  - _unique (institution_id, id)_
- **attendance_verification_events**
  - `id` uuid primary key default gen_random_uuid()
  - `institution_id` uuid not null references uniattend.institutions(id) on delete cascade
  - `session_id` uuid not null
  - `student_id` uuid not null
  - `outcome` text not null check (outcome in ('accepted','review','rejected','duplicate'))
  - `score` int not null check (score between 0 and 100)
  - `layers` jsonb not null, -- per-layer points and inputs summary
  - `reasons` jsonb not null default '[]'::jsonb
  - `token_step` bigint
  - `created_at` timestamptz not null default now()
  - _foreign key (institution_id, session_id) references uniattend.class_sessions(institution_id, id) on delete cascade_
  - _foreign key (institution_id, student_id) references uniattend.students(institution_id, id) on delete cascade_
- **audit_logs**
  - `id` bigint generated always as identity primary key
  - `institution_id` uuid references uniattend.institutions(id) on delete set null
  - `actor_id` uuid
  - `action` text not null
  - `entity` text not null
  - `entity_id` text
  - `details` jsonb not null default '{}'::jsonb
  - `created_at` timestamptz not null default now()
- **campuses**
  - `id` uuid primary key default gen_random_uuid()
  - `institution_id` uuid not null references uniattend.institutions(id) on delete cascade
  - `name` text not null
  - `address` text
  - `lat` double precision check (lat between -90 and 90)
  - `lng` double precision check (lng between -180 and 180)
  - `created_at` timestamptz not null default now()
  - `updated_at` timestamptz not null default now()
  - `deleted_at` timestamptz
  - _unique (institution_id, id)_
  - _unique (institution_id, name)_
  - `town` text check (town is null or length(town) <= 120) _(added later)_
  - `zoom` int not null default 16 check (zoom between 3 and 20) _(added later)_
  - `outline` jsonb check (outline is null or (jsonb_typeof(outline) = 'array' and jsonb_array_length(outline) between 3 and 500)) _(added later)_
  - `osm_ref` text check (osm_ref is null or osm_ref ~ '^(node|way|relation)/[0-9]+$') _(added later)_
- **class_sessions**
  - `id` uuid primary key default gen_random_uuid()
  - `institution_id` uuid not null references uniattend.institutions(id) on delete cascade
  - `module_id` uuid not null
  - `venue_id` uuid
  - `lecturer_id` uuid
  - `title` text not null default 'Lecture'
  - `status` text not null default 'open' check (status in ('scheduled','open','closed','cancelled'))
  - `opens_at` timestamptz not null default now()
  - `closes_at` timestamptz not null
  - `late_after` timestamptz not null
  - `closed_at` timestamptz
  - `join_code` text not null check (join_code ~ '^[A-HJ-NP-Z2-9]{6}$')
  - `require_qr` boolean not null
  - `require_gps` boolean not null
  - `created_by` uuid references auth.users(id) on delete set null
  - `created_at` timestamptz not null default now()
  - `updated_at` timestamptz not null default now()
  - _unique (institution_id, id)_
  - _check (closes_at > opens_at)_
  - _foreign key (institution_id, module_id) references uniattend.modules(institution_id, id) on delete cascade_
  - _foreign key (institution_id, venue_id) references uniattend.venues(institution_id, id)_
  - _foreign key (institution_id, lecturer_id) references uniattend.lecturers(institution_id, id)_
  - `allow_printed_qr` boolean not null default false _(added later)_
- **data_requests**
  - `id` uuid primary key default gen_random_uuid()
  - `user_id` uuid not null references auth.users(id) on delete cascade
  - `kind` text not null check (kind in ('deletion','correction','objection','other'))
  - `details` text not null check (length(trim(details)) between 5 and 2000)
  - `status` text not null default 'open' check (status in ('open','in_progress','done','declined'))
  - `response` text check (length(response) <= 2000)
  - `handled_by` uuid references auth.users(id) on delete set null
  - `handled_at` timestamptz
  - `created_at` timestamptz not null default now()
- **departments**
  - `id` uuid primary key default gen_random_uuid()
  - `institution_id` uuid not null references uniattend.institutions(id) on delete cascade
  - `faculty_id` uuid not null
  - `name` text not null
  - `code` text not null
  - `created_at` timestamptz not null default now()
  - `updated_at` timestamptz not null default now()
  - `deleted_at` timestamptz
  - _unique (institution_id, id)_
  - _unique (institution_id, code)_
  - _foreign key (institution_id, faculty_id) references uniattend.faculties(institution_id, id)_
- **faculties**
  - `id` uuid primary key default gen_random_uuid()
  - `institution_id` uuid not null references uniattend.institutions(id) on delete cascade
  - `name` text not null
  - `code` text not null
  - `created_at` timestamptz not null default now()
  - `updated_at` timestamptz not null default now()
  - `deleted_at` timestamptz
  - _unique (institution_id, id)_
  - _unique (institution_id, code)_
- **institution_directory**
  - `id` uuid primary key default gen_random_uuid()
  - `name` text not null unique check (length(trim(name)) between 2 and 200)
  - `short_name` text
  - `kind` text not null default 'university' check (kind in ('university','university_of_technology','tvet_college','college'))
  - `province` text
  - `website` text check (website is null or website ~ '^https://')
  - `timetable_source_type` text not null default 'none' check (timetable_source_type in ('none','viewer_json','pdf_links','pdf_url'))
  - `timetable_source_url` text check (timetable_source_url is null or timetable_source_url ~ '^https://[^\s"''<>]+$')
  - `timetable_note` text
  - `campuses` jsonb not null default '[]'::jsonb check (jsonb_typeof(campuses) = 'array')
  - `created_at` timestamptz not null default now()
  - `updated_at` timestamptz not null default now()
- **institution_domains**
  - `id` uuid primary key default gen_random_uuid()
  - `institution_id` uuid not null references uniattend.institutions(id) on delete cascade
  - `domain` text not null unique check (domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$')
  - `verified_at` timestamptz
  - `created_at` timestamptz not null default now()
- **institution_settings**
  - `institution_id` uuid primary key references uniattend.institutions(id) on delete cascade
  - `min_attendance_pct` int not null default 75 check (min_attendance_pct between 0 and 100)
  - `late_after_minutes` int not null default 10 check (late_after_minutes between 0 and 240)
  - `require_qr` boolean not null default true
  - `allow_manual_code` boolean not null default true
  - `require_gps` boolean not null default true
  - `acoustic_enabled` boolean not null default false
  - `gps_default_radius_m` int not null default 60 check (gps_default_radius_m between 10 and 2000)
  - `gps_max_accuracy_m` int not null default 150 check (gps_max_accuracy_m between 10 and 5000)
  - `accept_score` int not null default 70 check (accept_score between 0 and 100)
  - `review_score` int not null default 35 check (review_score between 0 and 100)
  - `retention_days` int not null default 1095 check (retention_days between 30 and 3650)
  - `updated_at` timestamptz not null default now()
  - _check (review_score <= accept_score)_
  - `timetable_source_type` text not null default 'none' check (timetable_source_type in ('none' _(added later)_
  - `timetable_source_url` text check (timetable_source_url is null or timetable_source_url ~ '^https://[^\s"''<>]+$') _(added later)_
  - `alerts_enabled` boolean not null default true _(added later)_
  - `alert_min_sessions` int not null default 3 check (alert_min_sessions between 1 and 50) _(added later)_
  - `alert_consecutive_absences` int not null default 3 check (alert_consecutive_absences between 2 and 20) _(added later)_
  - `auto_retention` boolean not null default false _(added later)_
  - `retention_last_run` timestamptz _(added later)_
- **institution_subscriptions**
  - `id` uuid primary key default gen_random_uuid()
  - `institution_id` uuid not null references uniattend.institutions(id) on delete cascade
  - `plan_id` uuid not null references uniattend.subscription_plans(id)
  - `status` text not null default 'trialing'
  - _check (status in ('trialing','active','past_due','suspended','cancelled'))_
  - `current_period_start` timestamptz not null default now()
  - `current_period_end` timestamptz not null default now() + interval '30 days'
  - `cancel_at` timestamptz
  - `created_at` timestamptz not null default now()
  - `updated_at` timestamptz not null default now()
- **institutions**
  - `id` uuid primary key default gen_random_uuid()
  - `name` text not null check (length(trim(name)) between 2 and 200)
  - `slug` text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$')
  - `short_name` text
  - `status` text not null default 'pending'
  - _check (status in ('pending','active','suspended','archived'))_
  - `country` text not null default 'ZA'
  - `timezone` text not null default 'Africa/Johannesburg'
  - `brand_primary` text not null default '#0b2545' check (brand_primary ~ '^#[0-9a-fA-F]{6}$')
  - `logo_path` text
  - `student_number_pattern` text, -- e.g. '^[0-9]{8}$' for UNIVEN
  - `contact_email` text
  - `created_by` uuid references auth.users(id) on delete set null
  - `created_at` timestamptz not null default now()
  - `updated_at` timestamptz not null default now()
  - `deleted_at` timestamptz
  - `theme` jsonb not null default '{}'::jsonb _(added later)_
  - `directory_id` uuid references uniattend.institution_directory(id) on delete set null _(added later)_
- **integration_checkpoints**
  - `integration_id` uuid not null references uniattend.integrations(id) on delete cascade
  - `institution_id` uuid not null references uniattend.institutions(id) on delete cascade
  - `dataset` text not null
  - `checkpoint` text not null check (length(checkpoint) <= 500)
  - `updated_at` timestamptz not null default now()
  - _primary key (integration_id, dataset)_
- **integration_errors**
  - `id` bigint generated always as identity primary key
  - `run_id` uuid not null references uniattend.integration_runs(id) on delete cascade
  - `institution_id` uuid not null references uniattend.institutions(id) on delete cascade
  - `dataset` text not null
  - `row_no` int
  - `ref` text, -- external id / number / code: enough to find the row at the source, never the whole row
  - `message` text not null
  - `created_at` timestamptz not null default now()
- **integration_external_ids**
  - `institution_id` uuid not null references uniattend.institutions(id) on delete cascade
  - `source` text not null check (length(source) between 1 and 80)
  - `entity` text not null
  - `external_id` text not null check (length(external_id) between 1 and 200)
  - `internal_id` uuid not null
  - `updated_at` timestamptz not null default now()
  - _primary key (institution_id, source, entity, external_id)_
- **integration_mappings**
  - `id` uuid primary key default gen_random_uuid()
  - `institution_id` uuid not null references uniattend.institutions(id) on delete cascade
  - `dataset` text not null check (dataset in ('faculties','departments','programmes','academic_periods','venues','modules'
  - `name` text not null check (length(trim(name)) between 1 and 80)
  - `mapping` jsonb not null check (jsonb_typeof(mapping) = 'object' and pg_column_size(mapping) < 8192)
  - `updated_by` uuid references auth.users(id) on delete set null
  - `updated_at` timestamptz not null default now()
  - _unique (institution_id, dataset, name)_
- **integration_runs**
  - `id` uuid primary key default gen_random_uuid()
  - `integration_id` uuid references uniattend.integrations(id) on delete cascade
  - `institution_id` uuid not null references uniattend.institutions(id) on delete cascade
  - `trigger` text not null default 'schedule' check (trigger in ('schedule','manual','api','upload'))
  - `status` text not null default 'running' check (status in ('running','ok','failed'))
  - `summary` jsonb not null default '{}'::jsonb
  - `unknown_modules` jsonb not null default '[]'::jsonb
  - `errors` jsonb not null default '[]'::jsonb
  - `error` text
  - `started_at` timestamptz not null default now()
  - `finished_at` timestamptz
  - `source` text _(added later)_
  - `label` text _(added later)_
  - `mode` text not null default 'full' _(added later)_
  - `complete` boolean not null default false _(added later)_
  - `checkpoints` jsonb not null default '{}'::jsonb _(added later)_
  - `created_by` uuid references auth.users(id) on delete set null _(added later)_
- **integration_secrets**
  - `integration_id` uuid primary key references uniattend.integrations(id) on delete cascade
  - `token` text, -- moodle / feed: sent to the institution's own system
  - `key_sha256` text check (key_sha256 ~ '^[0-9a-f]{64}$') -- api: hash of the key the institution's system sends us
- **integration_seen**
  - `run_id` uuid not null references uniattend.integration_runs(id) on delete cascade
  - `module_id` uuid not null, student_id uuid not null
  - _primary key (run_id, module_id, student_id)_
- **integration_seen_modules**
  - `run_id` uuid not null references uniattend.integration_runs(id) on delete cascade
  - `module_id` uuid not null
  - _primary key (run_id, module_id)_
- **integration_staging**
  - `id` bigint generated always as identity primary key
  - `run_id` uuid not null references uniattend.integration_runs(id) on delete cascade
  - `institution_id` uuid not null references uniattend.institutions(id) on delete cascade
  - `dataset` text not null check (dataset in ('faculties','departments','programmes','academic_periods','venues','modules'
  - `row_no` int not null
  - `payload` jsonb not null check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) < 8192)
  - `outcome` text check (outcome in ('insert','update','unchanged','duplicate','reject'))
  - `error` text
  - `internal_id` uuid
- **integrations**
  - `id` uuid primary key default gen_random_uuid()
  - `institution_id` uuid not null references uniattend.institutions(id) on delete cascade
  - `kind` text not null check (kind in ('moodle','feed','api'))
  - `name` text not null check (length(trim(name)) between 2 and 80)
  - `base_url` text check (base_url is null or (base_url ~ '^https://[^\s"''<>]+$' and length(base_url) between 12 and 500))
  - `options` jsonb not null default '{}'::jsonb check (jsonb_typeof(options) = 'object' and pg_column_size(options) < 4096)
  - `schedule` text not null default 'daily' check (schedule in ('manual','hourly','daily'))
  - `status` text not null default 'active' check (status in ('active','paused'))
  - `key_hint` text
  - `sync_requested_at` timestamptz
  - `claimed_at` timestamptz
  - `run_id` uuid
  - `step_no` int not null default 0
  - `last_run_at` timestamptz
  - `last_status` text
  - `last_summary` jsonb
  - `next_run_at` timestamptz not null default now()
  - `created_by` uuid references auth.users(id) on delete set null
  - `created_at` timestamptz not null default now()
  - `updated_at` timestamptz not null default now()
  - _check ((kind = 'api') = (base_url is null))_
  - `connection_status` text not null default 'not_configured' _(added later)_
  - `last_tested_at` timestamptz _(added later)_
  - `last_test_message` text _(added later)_
  - `last_success_at` timestamptz _(added later)_
- **lecturer_assignments**
  - `id` uuid primary key default gen_random_uuid()
  - `institution_id` uuid not null references uniattend.institutions(id) on delete cascade
  - `module_id` uuid not null
  - `lecturer_id` uuid not null
  - `role` text not null default 'primary' check (role in ('primary','assistant'))
  - `created_at` timestamptz not null default now()
  - _unique (module_id, lecturer_id)_
  - _foreign key (institution_id, module_id) references uniattend.modules(institution_id, id) on delete cascade_
  - _foreign key (institution_id, lecturer_id) references uniattend.lecturers(institution_id, id) on delete cascade_
  - `source` uuid _(added later)_
- **lecturers**
  - `id` uuid primary key default gen_random_uuid()
  - `institution_id` uuid not null references uniattend.institutions(id) on delete cascade
  - `user_id` uuid references auth.users(id) on delete set null
  - `staff_number` text not null
  - `full_name` text not null
  - `email` text
  - `department_id` uuid
  - `status` text not null default 'active' check (status in ('active','suspended','left'))
  - `created_at` timestamptz not null default now()
  - `updated_at` timestamptz not null default now()
  - `deleted_at` timestamptz
  - _unique (institution_id, id)_
  - _unique (institution_id, staff_number)_
  - _unique (institution_id, user_id)_
  - _foreign key (institution_id, department_id) references uniattend.departments(institution_id, id)_
  - `source` text check (source is null or source in ('manual' _(added later)_
- **module_enrolments**
  - `id` uuid primary key default gen_random_uuid()
  - `institution_id` uuid not null references uniattend.institutions(id) on delete cascade
  - `module_id` uuid not null
  - `student_id` uuid not null
  - `status` text not null default 'active' check (status in ('active','dropped'))
  - `created_at` timestamptz not null default now()
  - _unique (module_id, student_id)_
  - _foreign key (institution_id, module_id) references uniattend.modules(institution_id, id) on delete cascade_
  - _foreign key (institution_id, student_id) references uniattend.students(institution_id, id) on delete cascade_
  - `source` uuid _(added later)_
- **modules**
  - `id` uuid primary key default gen_random_uuid()
  - `institution_id` uuid not null references uniattend.institutions(id) on delete cascade
  - `department_id` uuid
  - `academic_period_id` uuid
  - `code` text not null
  - `title` text not null
  - `credits` int check (credits >= 0)
  - `min_attendance_pct` int check (min_attendance_pct between 0 and 100), -- null = institution default
  - `created_at` timestamptz not null default now()
  - `updated_at` timestamptz not null default now()
  - `deleted_at` timestamptz
  - _unique (institution_id, id)_
  - _unique nulls not distinct (institution_id, code, academic_period_id)_
  - _foreign key (institution_id, department_id) references uniattend.departments(institution_id, id)_
  - _foreign key (institution_id, academic_period_id) references uniattend.academic_periods(institution_id, id)_
  - `expected_students` int check (expected_students is null or expected_students between 0 and 100000) _(added later)_
- **notifications**
  - `id` uuid primary key default gen_random_uuid()
  - `institution_id` uuid references uniattend.institutions(id) on delete cascade
  - `user_id` uuid not null references auth.users(id) on delete cascade
  - `kind` text not null
  - `title` text not null
  - `body` text
  - `link` text check (link is null or link ~ '^/'), -- in-app paths only
  - `read_at` timestamptz
  - `created_at` timestamptz not null default now()
  - `pushed_at` timestamptz _(added later)_
  - `dedupe_key` text _(added later)_
- **payments**
  - `id` uuid primary key default gen_random_uuid()
  - `institution_id` uuid not null references uniattend.institutions(id) on delete cascade
  - `subscription_id` uuid references uniattend.institution_subscriptions(id) on delete set null
  - `provider` text not null check (provider in ('payfast','paystack','manual'))
  - `provider_ref` text not null
  - `amount_cents` bigint not null check (amount_cents >= 0)
  - `currency` text not null default 'ZAR'
  - `status` text not null check (status in ('pending','succeeded','failed','refunded'))
  - `verified_at` timestamptz
  - `created_at` timestamptz not null default now()
  - _unique (provider, provider_ref)_
- **profiles**
  - `id` uuid primary key references auth.users(id) on delete cascade
  - `full_name` text not null default ''
  - `email` text
  - `phone` text
  - `avatar_path` text
  - `created_at` timestamptz not null default now()
  - `updated_at` timestamptz not null default now()
- **push_config**
  - `id` int primary key default 1 check (id = 1)
  - `secret_sha256` text not null check (secret_sha256 ~ '^[0-9a-f]{64}$')
  - `reminder_minutes` int not null default 15 check (reminder_minutes between 5 and 120)
  - `updated_at` timestamptz not null default now()
- **push_subscriptions**
  - `id` uuid primary key default gen_random_uuid()
  - `user_id` uuid not null references auth.users(id) on delete cascade
  - `endpoint` text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000)
  - `p256dh` text not null check (length(p256dh) between 20 and 200)
  - `auth` text not null check (length(auth) between 8 and 100)
  - `user_agent` text check (user_agent is null or length(user_agent) <= 300)
  - `prefs` jsonb not null default '{"classes": true, "announcements": true, "attendance": true}'::jsonb
  - `created_at` timestamptz not null default now()
  - `last_sent_at` timestamptz
- **session_secrets**
  - `session_id` uuid primary key references uniattend.class_sessions(id) on delete cascade
  - `secret` bytea not null
- **student_alert_events**
  - `id` uuid primary key default gen_random_uuid()
  - `institution_id` uuid not null references uniattend.institutions(id) on delete cascade
  - `alert_id` uuid not null
  - `actor_id` uuid references auth.users(id) on delete set null, -- null = automatic
  - `action` text not null check (action in
  - `note` text check (note is null or length(note) <= 2000)
  - `created_at` timestamptz not null default now()
  - _foreign key (institution_id, alert_id) references uniattend.student_alerts(institution_id, id) on delete cascade_
- **student_alerts**
  - `id` uuid primary key default gen_random_uuid()
  - `institution_id` uuid not null references uniattend.institutions(id) on delete cascade
  - `student_id` uuid not null
  - `module_id` uuid not null
  - `kind` text not null check (kind in ('low_attendance', 'missed_in_a_row'))
  - `status` text not null default 'open' check (status in ('open', 'contacted', 'resolved', 'dismissed'))
  - `percent` numeric(5,1), -- worst-case attendance % when last checked
  - `missed_in_a_row` int
  - `required_pct` int
  - `assigned_to` uuid references auth.users(id) on delete set null
  - `resolved_at` timestamptz
  - `created_at` timestamptz not null default now()
  - `updated_at` timestamptz not null default now()
  - _unique (institution_id, id)_
  - _foreign key (institution_id, student_id) references uniattend.students(institution_id, id) on delete cascade_
  - _foreign key (institution_id, module_id) references uniattend.modules(institution_id, id) on delete cascade_
- **students**
  - `id` uuid primary key default gen_random_uuid()
  - `institution_id` uuid not null references uniattend.institutions(id) on delete cascade
  - `user_id` uuid references auth.users(id) on delete set null
  - `student_number` text not null check (length(trim(student_number)) between 3 and 32)
  - `full_name` text not null
  - `email` text
  - `programme_id` uuid
  - `year_of_study` int check (year_of_study between 1 and 10)
  - `status` text not null default 'active' check (status in ('active','suspended','graduated','withdrawn'))
  - `created_at` timestamptz not null default now()
  - `updated_at` timestamptz not null default now()
  - `deleted_at` timestamptz
  - _unique (institution_id, id)_
  - _unique (institution_id, student_number)_
  - _unique (institution_id, user_id)_
  - _foreign key (institution_id, programme_id) references uniattend.academic_programmes(institution_id, id)_
- **subscription_plans**
  - `id` uuid primary key default gen_random_uuid()
  - `code` text not null unique check (code ~ '^[a-z0-9_-]{2,40}$')
  - `name` text not null
  - `description` text
  - `price_cents` bigint check (price_cents >= 0)
  - `currency` text not null default 'ZAR'
  - `billing_interval` text not null default 'year' check (billing_interval in ('month','year'))
  - `max_students` int check (max_students > 0), -- null = unlimited
  - `max_lecturers` int check (max_lecturers > 0)
  - `max_modules` int check (max_modules > 0)
  - `features` jsonb not null default '{}'::jsonb
  - `is_active` boolean not null default true
  - `sort_order` int not null default 0
  - `created_at` timestamptz not null default now()
  - `updated_at` timestamptz not null default now()
- **theme_versions**
  - `id` uuid primary key default gen_random_uuid()
  - `institution_id` uuid not null references uniattend.institutions(id) on delete cascade
  - `status` text not null check (status in ('draft','published'))
  - `theme` jsonb not null check (jsonb_typeof(theme) = 'object' and pg_column_size(theme) < 16384)
  - `note` text check (length(note) <= 120)
  - `created_by` uuid references auth.users(id) on delete set null
  - `created_by_name` text
  - `created_at` timestamptz not null default now()
  - `updated_at` timestamptz not null default now()
- **timetables**
  - `id` uuid primary key default gen_random_uuid()
  - `institution_id` uuid not null references uniattend.institutions(id) on delete cascade
  - `module_id` uuid not null
  - `venue_id` uuid
  - `weekday` int not null check (weekday between 1 and 7), -- ISO: 1 = Monday
  - `starts_at` time not null
  - `ends_at` time not null
  - `created_at` timestamptz not null default now()
  - `updated_at` timestamptz not null default now()
  - _check (ends_at > starts_at)_
  - _foreign key (institution_id, module_id) references uniattend.modules(institution_id, id) on delete cascade_
  - _foreign key (institution_id, venue_id) references uniattend.venues(institution_id, id)_
  - `kind` text not null default 'lecture' check (kind in ('lecture' _(added later)_
  - `group_name` text check (group_name is null or length(group_name) <= 40) _(added later)_
  - `created_by` uuid references auth.users(id) on delete set null _(added later)_
  - `lecturer_id` uuid _(added later)_
- **usage_metrics**
  - `id` uuid primary key default gen_random_uuid()
  - `institution_id` uuid not null references uniattend.institutions(id) on delete cascade
  - `metric` text not null
  - `value` bigint not null
  - `measured_on` date not null default current_date
  - _unique (institution_id, metric, measured_on)_
- **user_roles**
  - `id` uuid primary key default gen_random_uuid()
  - `user_id` uuid not null references auth.users(id) on delete cascade
  - `institution_id` uuid references uniattend.institutions(id) on delete cascade
  - `role` text not null check (role in ('super_admin','institution_admin','lecturer','student'))
  - `status` text not null default 'active' check (status in ('active','suspended'))
  - `granted_by` uuid references auth.users(id) on delete set null
  - `created_at` timestamptz not null default now()
  - _check ((role = 'super_admin') = (institution_id is null))_
  - _unique nulls not distinct (user_id, institution_id, role)_
  - `left_at` timestamptz _(added later)_
- **venues**
  - `id` uuid primary key default gen_random_uuid()
  - `institution_id` uuid not null references uniattend.institutions(id) on delete cascade
  - `campus_id` uuid
  - `name` text not null
  - `code` text
  - `capacity` int check (capacity > 0)
  - `lat` double precision check (lat between -90 and 90)
  - `lng` double precision check (lng between -180 and 180)
  - `radius_m` int check (radius_m between 5 and 2000)
  - `polygon` jsonb check (polygon is null or (jsonb_typeof(polygon) = 'array' and jsonb_array_length(polygon) >= 3))
  - `created_at` timestamptz not null default now()
  - `updated_at` timestamptz not null default now()
  - `deleted_at` timestamptz
  - _unique (institution_id, id)_
  - _foreign key (institution_id, campus_id) references uniattend.campuses(institution_id, id)_
  - `building` text check (building is null or length(building) <= 120) _(added later)_

Dropped by later migrations (do not recreate): live_locations, location_consents

## C. Row-level security policies (final definition of each)

- `acoustic_windows`.`acoustic_windows_select` — select to authenticated: `using (exists (select 1 from uniattend.class_sessions cs where cs.id = session_id and (uniattend.teaches_module(cs.module_id) or uniattend.enrolled_in_module(cs.module_id))))`
- `announcements`.`announcements_select` — select to authenticated: `using (uniattend.is_super_admin() or (institution_id is not null and uniattend.is_inst_admin(institution_id)) or (target_kind = 'all' and published_at <= now() and (expires_at is null or expires_at > now()) and (institution_id is null or uniattend.is_member(institution_id))))`
- `announcements`.`announcements_write` — all to authenticated: `using (case when institution_id is null then uniattend.is_super_admin() else uniattend.is_inst_admin(institution_id) end) with check (case when institution_id is null then uniattend.is_super_admin() else uniattend.is_inst_admin(institution_id) end)`
- `attendance_disputes`.`attendance_disputes_select` — select to authenticated: `using (uniattend.is_inst_admin(institution_id) or uniattend.is_own_student(student_id) or uniattend.teaches_module(uniattend.module_of_record(record_id)))`
- `attendance_evidence`.`attendance_evidence_select` — select to authenticated: `using (uniattend.is_inst_admin(institution_id) or uniattend.teaches_module(uniattend.module_of_record(record_id)) or exists (select 1 from uniattend.attendance_records ar where ar.id = record_id and uniattend.is_own_student(ar.student_id)))`
- `attendance_records`.`attendance_records_select` — select to authenticated: `using (uniattend.is_inst_admin(institution_id) or uniattend.teaches_module(module_id) or uniattend.is_own_student(student_id))`
- `attendance_statuses`.`attendance_statuses_select` — select to authenticated: `using (uniattend.is_member(institution_id) or uniattend.is_super_admin())`
- `attendance_statuses`.`attendance_statuses_write` — all to authenticated: `using (uniattend.is_inst_admin(institution_id)) with check (uniattend.is_inst_admin(institution_id))`
- `attendance_verification_events`.`verification_events_select` — select to authenticated: `using (uniattend.is_inst_admin(institution_id) or uniattend.is_own_student(student_id) or exists (select 1 from uniattend.class_sessions cs where cs.id = session_id and uniattend.teaches_module(cs.module_id)))`
- `audit_logs`.`audit_logs_select` — select to authenticated: `using (uniattend.is_super_admin() or (institution_id is not null and uniattend.is_inst_admin(institution_id)))`
- `class_sessions`.`class_sessions_select` — select to authenticated: `using (uniattend.is_inst_admin(institution_id) or uniattend.teaches_module(module_id) or uniattend.enrolled_in_module(module_id))`
- `data_requests`.`data_requests_select` — select to authenticated: `using (user_id = (select auth.uid()) or uniattend.is_super_admin() or exists (select 1 from uniattend.user_roles r where r.user_id = data_requests.user_id and r.institution_id is not null and uniattend.is_inst_admin(r.institution_id)))`
- `institution_directory`.`institution_directory_super` — all to authenticated: `using (uniattend.is_super_admin()) with check (uniattend.is_super_admin())`
- `institution_domains`.`institution_domains_select` — select to authenticated: `using (uniattend.is_inst_admin(institution_id))`
- `institution_domains`.`institution_domains_write` — all to authenticated: `using (uniattend.is_super_admin()) with check (uniattend.is_super_admin())`
- `institution_settings`.`institution_settings_select` — select to authenticated: `using (uniattend.is_super_admin() or uniattend.is_member(institution_id))`
- `institution_settings`.`institution_settings_update` — update to authenticated: `using (uniattend.is_inst_admin(institution_id)) with check (uniattend.is_inst_admin(institution_id))`
- `institution_subscriptions`.`institution_subscriptions_select` — select to authenticated: `using (uniattend.is_inst_admin(institution_id))`
- `institution_subscriptions`.`institution_subscriptions_write` — all to authenticated: `using (uniattend.is_super_admin()) with check (uniattend.is_super_admin())`
- `institutions`.`institutions_delete` — delete to authenticated: `using (uniattend.is_super_admin())`
- `institutions`.`institutions_select` — select to authenticated: `using (uniattend.is_super_admin() or uniattend.is_member(id) or created_by = (select auth.uid()))`
- `institutions`.`institutions_update` — update to authenticated: `using (uniattend.is_inst_admin(id)) with check (uniattend.is_inst_admin(id))`
- `integration_checkpoints`.`integration_checkpoints_select` — select to authenticated: `using (uniattend.is_inst_admin(institution_id))`
- `integration_errors`.`integration_errors_select` — select to authenticated: `using (uniattend.is_inst_admin(institution_id) or uniattend.is_super_admin())`
- `integration_external_ids`.`integration_external_ids_select` — select to authenticated: `using (uniattend.is_inst_admin(institution_id))`
- `integration_mappings`.`integration_mappings_delete` — delete to authenticated: `using (uniattend.is_inst_admin(institution_id))`
- `integration_mappings`.`integration_mappings_insert` — insert to authenticated: `with check (uniattend.is_inst_admin(institution_id))`
- `integration_mappings`.`integration_mappings_select` — select to authenticated: `using (uniattend.is_inst_admin(institution_id))`
- `integration_mappings`.`integration_mappings_update` — update to authenticated: `using (uniattend.is_inst_admin(institution_id)) with check (uniattend.is_inst_admin(institution_id))`
- `integration_runs`.`integration_runs_select` — select to authenticated: `using (uniattend.is_super_admin() or uniattend.is_inst_admin(institution_id))`
- `integration_staging`.`integration_staging_select` — select to authenticated: `using (uniattend.is_inst_admin(institution_id))`
- `integrations`.`integrations_select` — select to authenticated: `using (uniattend.is_super_admin() or uniattend.is_inst_admin(institution_id))`
- `lecturers`.`lecturers_admin_write` — all to authenticated: `using (uniattend.is_inst_admin(institution_id)) with check (uniattend.is_inst_admin(institution_id))`
- `lecturers`.`lecturers_select` — select to authenticated: `using (uniattend.is_super_admin() or uniattend.is_member(institution_id))`
- `live_locations`.`live_locations_select` — select to authenticated: `using (user_id = (select auth.uid()) or uniattend.is_inst_admin(institution_id))`
- `location_consents`.`location_consents_select` — select to authenticated: `using (user_id = (select auth.uid()) or uniattend.is_inst_admin(institution_id))`
- `module_enrolments`.`module_enrolments_admin_write` — all to authenticated: `using (uniattend.is_inst_admin(institution_id)) with check (uniattend.is_inst_admin(institution_id))`
- `module_enrolments`.`module_enrolments_select` — select to authenticated: `using (uniattend.is_inst_admin(institution_id) or uniattend.teaches_module(module_id) or uniattend.is_own_student(student_id))`
- `notifications`.`notifications_select` — select to authenticated: `using (user_id = (select auth.uid()))`
- `payments`.`payments_select` — select to authenticated: `using (uniattend.is_inst_admin(institution_id))`
- `profiles`.`profiles_select` — select to authenticated: `using (id = (select auth.uid()) or uniattend.is_super_admin() or exists (select 1 from uniattend.user_roles r where r.user_id = profiles.id and uniattend.is_inst_admin(r.institution_id)))`
- `profiles`.`profiles_update` — update to authenticated: `using (id = (select auth.uid())) with check (id = (select auth.uid()))`
- `push_subscriptions`.`push_subscriptions_delete` — delete to authenticated: `using (user_id = (select auth.uid()))`
- `push_subscriptions`.`push_subscriptions_own` — select to authenticated: `using (user_id = (select auth.uid()))`
- `student_alert_events`.`student_alert_events_select` — select to authenticated: `using (exists (select 1 from uniattend.student_alerts a where a.id = alert_id and (uniattend.is_inst_admin(a.institution_id) or uniattend.teaches_module(a.module_id))))`
- `student_alerts`.`student_alerts_select` — select to authenticated: `using (uniattend.is_inst_admin(institution_id) or uniattend.teaches_module(module_id))`
- `students`.`students_admin_write` — all to authenticated: `using (uniattend.is_inst_admin(institution_id)) with check (uniattend.is_inst_admin(institution_id))`
- `students`.`students_select` — select to authenticated: `using (uniattend.is_inst_admin(institution_id) or user_id = (select auth.uid()) or uniattend.lecturer_sees_student(id))`
- `subscription_plans`.`subscription_plans_select` — select to authenticated: `using (is_active or uniattend.is_super_admin())`
- `subscription_plans`.`subscription_plans_write` — all to authenticated: `using (uniattend.is_super_admin()) with check (uniattend.is_super_admin())`
- `theme_versions`.`theme_versions_select` — select to authenticated: `using (uniattend.is_super_admin() or uniattend.is_inst_admin(institution_id))`
- `usage_metrics`.`usage_metrics_select` — select to authenticated: `using (uniattend.is_inst_admin(institution_id))`
- `user_roles`.`user_roles_select` — select to authenticated: `using (user_id = (select auth.uid()) or uniattend.is_super_admin() or (institution_id is not null and uniattend.is_inst_admin(institution_id)))`

## D. Database functions (last definition wins)

- `_integration_mark_success()` → trigger — internal
- `_sync_apply(p_run uuid)` → jsonb — internal
- `_sync_dupes()` → void — internal
- `_sync_finish(p_inst uuid, p_src text, p_entity text, p_commit boolean)` → jsonb — internal
- `_sync_match_ext(p_inst uuid, p_src text, p_entity text)` → void — internal
- `_sync_process(p_run uuid, p_commit boolean)` → jsonb — internal
- `_sync_stage(p_run uuid, p_dataset text, p_rows jsonb, p_first_row int)` → int — internal
- `_sync_totals(p_res jsonb)` → jsonb — internal
- `alert_history(p_alert uuid)` → table (at timestamptz, action text, note text, actor_name text) — callable by: authenticated
- `alerts_on_records_changed()` → trigger — internal
- `alerts_on_session_closed()` → trigger — internal
- `announcement_recipients(a uniattend.announcements)` → table (user_id uuid, institution_id uuid) — internal
- `answer_data_request(p_id uuid, p_status text, p_response text)` → void — callable by: authenticated
- `apply_checkout(p_record uuid)` → jsonb — internal
- `apply_paystack_payment( p_institution uuid, p_plan_code text, p_reference text, p_amount bigint, p_currency text)` → text — callable by: service_role
- `apply_retention(p_inst uuid)` → jsonb — callable by: authenticated
- `audit_trigger()` → trigger — internal
- `can_bulk_import(p_inst uuid)` → boolean — callable by: authenticated
- `can_write_branding(p_name text)` → boolean — callable by: authenticated
- `change_subscription(p_inst uuid, p_plan_code text, p_status text, p_period_end timestamptz)` → void — internal
- `check_in(p_session uuid, p_code text, p_token text, p_gps jsonb, p_device_hash text)` → jsonb — internal
- `check_in_offline(p_session uuid, p_code text, p_token text, p_gps jsonb, p_device_hash text, p_captured_at timestamptz)` → jsonb — callable by: authenticated
- `check_out(p_session uuid)` → jsonb — callable by: authenticated
- `close_session(p_session uuid)` → jsonb — internal
- `decide_late(p_session uuid, p_students uuid[], p_accept boolean, p_note text default null)` → int — callable by: authenticated
- `discard_theme_draft(p_institution uuid)` → void — callable by: authenticated
- `enforce_plan_limits()` → trigger — internal
- `enrolled_in_module(p_module uuid)` → boolean — internal
- `ensure_profile()` → void — internal
- `evaluate_module_alerts(p_module uuid)` → int — internal
- `fan_out_announcement()` → trigger — internal
- `generate_join_code(p_inst uuid)` → text — internal
- `geo_distance_m(lat1 float8, lng1 float8, lat2 float8, lng2 float8)` → float8 — internal
- `grant_role(p_inst uuid, p_email text, p_role text)` → uuid — internal
- `guard_institution_update()` → trigger — internal
- `guard_timetable_source()` → trigger — internal
- `handle_new_user()` → trigger — internal
- `has_role(p_inst uuid, p_roles text[])` → boolean — internal
- `import_add(p_run uuid, p_dataset text, p_rows jsonb)` → int — callable by: authenticated
- `import_cancel(p_run uuid)` → void — callable by: authenticated
- `import_commit(p_run uuid)` → jsonb — callable by: authenticated
- `import_preview(p_run uuid)` → jsonb — callable by: authenticated
- `import_roster(p_inst uuid, p_payload jsonb)` → jsonb — callable by: authenticated
- `import_start(p_inst uuid, p_source text, p_label text, p_complete boolean default false)` → uuid — callable by: authenticated
- `import_students(p_inst uuid, p_rows jsonb)` → jsonb — internal
- `institution_can_operate(p_inst uuid)` → boolean — internal
- `institution_dashboard(p_inst uuid)` → jsonb — callable by: authenticated
- `institution_overview(p_inst uuid)` → jsonb — internal
- `integration_action(p_id uuid, p_action text)` → jsonb — callable by: authenticated
- `integration_apply(p_secret text, p_run uuid, p_payload jsonb, p_cursor int)` → jsonb — callable by: anon, authenticated
- `integration_claim(p_secret text)` → jsonb — callable by: anon, authenticated
- `integration_done(p_secret text, p_run uuid, p_status text, p_error text, p_complete boolean)` → jsonb — callable by: anon, authenticated
- `integration_finish(p_run uuid, p_status text, p_error text, p_complete boolean)` → jsonb — internal
- `integration_secret(p_secret text, p_id uuid)` → text — callable by: anon, authenticated
- `integration_test_result(p_secret text, p_id uuid, p_status text, p_message text)` → void — callable by: anon, authenticated
- `is_inst_admin(p_inst uuid)` → boolean — internal
- `is_member(p_inst uuid)` → boolean — internal
- `is_own_student(p_student uuid)` → boolean — internal
- `is_super_admin()` → boolean — internal
- `leave_institution(p_inst uuid)` → int — callable by: authenticated
- `lecturer_sees_student(p_student uuid)` → boolean — internal
- `link_my_accounts()` → jsonb — internal
- `list_student_alerts(p_inst uuid, p_live_only boolean default true)` → table (id uuid, kind text, status text, percent numeric, missed_in_a_row int, required_pct int, created_at timestamptz, updated_at timestamptz, student_id uuid, student_number text, student_name text, module_id uuid, module_code text, module_title text, assigned_to uuid, assignee_name text, last_note text) — callable by: authenticated
- `live_plan(p_inst uuid)` → table (plan uniattend.subscription_plans, sub_status text, period_end timestamptz) — internal
- `mark_notifications_read(p_ids uuid[] default null)` → void — internal
- `module_of_record(p_record uuid)` → uuid — internal
- `module_report(p_module uuid)` → table (student_id uuid, student_number text, full_name text, sessions int, attended int, late int, absent int, excused int, unresolved int, percent numeric, worst_case_percent numeric, meets_requirement boolean, at_risk boolean) — internal
- `my_attendance()` → table (institution_id uuid, module_id uuid, code text, title text, attended int, absent int, excused int, unresolved int, percent numeric, min_pct int) — internal
- `my_next_classes(p_inst uuid, p_limit int default 5)` → table (module_code text, module_title text, venue_id uuid, venue_name text, venue_code text, lat float8, lng float8, radius_m int, starts_at timestamptz, ends_at timestamptz) — internal
- `my_personal_data()` → jsonb — callable by: authenticated
- `my_roles()` → table (institution_id uuid, institution_name text, institution_slug text, institution_status text, brand_primary text, role text) — internal
- `notify_joined(p_user uuid, p_inst uuid, p_role text)` → void — internal
- `open_session(p_module uuid, p_venue uuid, p_title text, p_minutes int default 90, p_late_minutes int default null)` → uniattend.class_sessions — internal
- `override_attendance(p_session uuid, p_student uuid, p_status text, p_note text)` → uniattend.attendance_records — internal
- `plan_feature(p_inst uuid, p_feature text)` → boolean — internal
- `platform_overview()` → jsonb — internal
- `polygon_signed_distance_m(p_lat float8, p_lng float8, p_poly jsonb)` → float8 — internal
- `printed_qr_token(p_session uuid)` → text — callable by: authenticated
- `public_branding(p_key text)` → jsonb — callable by: anon, authenticated
- `publish_theme(p_institution uuid, p_theme jsonb, p_note text default null)` → uuid — callable by: authenticated
- `push_claim(p_secret text, p_limit int default 500)` → table (notification_id uuid, kind text, title text, body text, link text, created_at timestamptz, institution_name text, logo_url text, endpoint text, p256dh text, auth text) — callable by: anon, authenticated
- `push_forget(p_secret text, p_endpoint text)` → void — callable by: anon, authenticated
- `push_secret_ok(p_secret text)` → boolean — internal
- `push_sent(p_secret text, p_endpoints text[])` → void — callable by: anon, authenticated
- `push_test()` → void — callable by: authenticated
- `qr_sign(p_session uuid, p_step bigint)` → text — internal
- `qr_step()` → bigint — internal
- `qr_verify(p_session uuid, p_token text)` → bigint — internal
- `queue_class_reminders(p_minutes int default 15)` → int — internal
- `recheck_alerts(p_inst uuid)` → int — callable by: authenticated
- `record_history(p_record uuid)` → table (at timestamptz, kind text, summary text, by_name text, note text) — callable by: authenticated
- `record_manual_payment(p_inst uuid, p_amount_cents bigint, p_reference text, p_months int, p_plan_code text default null)` → jsonb — callable by: authenticated
- `request_data_action(p_kind text, p_details text)` → uuid — callable by: authenticated
- `request_institution(p_name text, p_slug text, p_contact_email text default null)` → uuid — internal
- `resolve_dispute(p_dispute uuid, p_upheld boolean, p_new_status text, p_note text)` → void — internal
- `retention_counts(p_inst uuid)` → jsonb — internal
- `retention_delete(p_inst uuid, p_by text)` → jsonb — internal
- `retention_preview(p_inst uuid)` → jsonb — callable by: authenticated
- `retry_run(p_run uuid)` → void — callable by: authenticated
- `roster_apply(p_inst uuid, p_integration uuid, p_run uuid, p_payload jsonb)` → jsonb — internal
- `roster_push(p_key text, p_payload jsonb)` → jsonb — callable by: anon, authenticated
- `run_retention()` → int — internal
- `save_integration(p_inst uuid, p_id uuid, p_kind text, p_name text, p_base_url text, p_token text, p_options jsonb, p_schedule text)` → jsonb — callable by: authenticated
- `save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null, p_prefs jsonb default null)` → uuid — callable by: authenticated
- `save_register(p_session uuid, p_entries jsonb, p_note text default null)` → jsonb — callable by: authenticated
- `save_theme_draft(p_institution uuid, p_theme jsonb)` → timestamptz — callable by: authenticated
- `scan_student(p_session uuid, p_code text, p_direction text default 'in')` → jsonb — callable by: authenticated
- `seed_attendance_statuses()` → trigger — internal
- `send_class_message(p_module uuid, p_category text, p_title text, p_body text)` → int — callable by: authenticated
- `session_control(p_session uuid, p_action text, p_closes_in_min int default null, p_late_in_min int default null)` → jsonb — callable by: authenticated
- `session_qr_token(p_session uuid)` → jsonb — internal
- `set_auto_retention(p_inst uuid, p_on boolean)` → void — callable by: authenticated
- `set_institution_status(p_inst uuid, p_status text)` → void — internal
- `set_push_secret(p_secret text, p_reminder_minutes int default 15)` → void — callable by: authenticated
- `set_role_status(p_role_id uuid, p_status text)` → void — internal
- `submit_dispute(p_record uuid, p_reason text)` → uuid — internal
- `subscription_notice(p_inst uuid)` → jsonb — callable by: authenticated
- `sync_begin(p_secret text, p_integration uuid, p_mode text, p_trigger text)` → jsonb — callable by: anon, authenticated
- `sync_commit(p_secret text, p_run uuid, p_complete boolean, p_checkpoints jsonb)` → jsonb — callable by: anon, authenticated
- `sync_fail(p_secret text, p_run uuid, p_error text)` → void — callable by: anon, authenticated
- `sync_stage(p_secret text, p_run uuid, p_dataset text, p_rows jsonb)` → int — callable by: anon, authenticated
- `sync_status(p_kind text, p_raw text)` → text — internal
- `teaches_module(p_module uuid)` → boolean — internal
- `theme_author()` → text — internal
- `timetable_no_clash()` → trigger — internal
- `touch_updated_at()` → trigger — internal
- `update_student_alert(p_alert uuid, p_action text, p_note text default null)` → uniattend.student_alerts — callable by: authenticated
- `write_audit(p_inst uuid, p_action text, p_entity text, p_entity_id text, p_details jsonb default '{}')` → void — internal

## E. Every source file, with its purpose

### `src/app/`

- `src/app/(auth)/actions.ts` (82 lines) — The bot-protection token from the form (see src/components/captcha.tsx); Supabase Auth checks it when CAPTCHA is on.
- `src/app/(auth)/forgot-password/page.tsx` (20 lines)
- `src/app/(auth)/layout.tsx` (45 lines) — Sign-in, registration and password pages wear the institution's look when
- `src/app/(auth)/login/login-form.tsx` (65 lines) — The sign-in form, built so browsers and phones can save and fill the password:
- `src/app/(auth)/login/page.tsx` (21 lines)
- `src/app/(auth)/reset-password/page.tsx` (18 lines)
- `src/app/(auth)/signup/page.tsx` (36 lines)
- `src/app/actions.ts` (35 lines) — Keep the institution's branding on the sign-in page for whoever signs in next on this device.
- `src/app/admin/actions.ts` (325 lines) — "" must be tested first: z.coerce.number() would turn it into 0.
- `src/app/admin/announce-form.tsx` (56 lines) — Send an announcement to everyone, a faculty, a department, a module, one student or one lecturer.
- `src/app/admin/audit/page.tsx` (27 lines)
- `src/app/admin/connections/actions.ts` (161 lines) — Server-to-database client for the steps that need the dispatch secret (never the user's session).
- `src/app/admin/connections/connection-forms.tsx` (141 lines)
- `src/app/admin/connections/page.tsx` (175 lines)
- `src/app/admin/data-actions.ts` (243 lines) — Frees a unique number/code on an archived row so the same one can be added again later.
- `src/app/admin/data/data-table.tsx` (131 lines) — The Data page table: tick rows for bulk actions, or edit one row inline.
- `src/app/admin/data/export/route.ts` (20 lines) — CSV of any Data tab, with the same search and archived filter as the page.
- `src/app/admin/data/page.tsx` (66 lines) — Every record the institution keeps, in one place: search, edit, bulk actions, export, restore.
- `src/app/admin/design/actions.ts` (88 lines) — Publish: everyone at the institution sees it, and it is kept in the version history.
- `src/app/admin/design/designer.tsx` (471 lines) — Starting points only; every colour stays editable.
- `src/app/admin/design/menus-features.tsx` (82 lines) — Features: switch optional parts of UniAttend on or off for the whole institution.
- `src/app/admin/design/page.tsx` (33 lines)
- `src/app/admin/early-warning/page.tsx` (82 lines)
- `src/app/admin/integrations/import/[run]/errors/route.ts` (29 lines) — The rejected rows of one import, as a CSV to fix and upload again.
- `src/app/admin/integrations/import/[run]/page.tsx` (116 lines)
- `src/app/admin/integrations/import/actions.ts` (135 lines) — A CSV, Excel or JSON file as a header row and cells. Throws a message fit to show.
- `src/app/admin/integrations/import/import-wizard.tsx` (145 lines) — Upload → match the file's columns to UniAttend's fields → preview. The file stays in the browser until step 2 is submitted.
- `src/app/admin/integrations/import/page.tsx` (80 lines)
- `src/app/admin/layout.tsx` (39 lines)
- `src/app/admin/modules/assign-actions.ts` (111 lines) — The institution always comes from the admin's own role, never from the form.
- `src/app/admin/modules/assign-import.tsx` (105 lines) — Upload a PDF, Word, Excel or CSV list; review the matches; assign lecturers to modules.
- `src/app/admin/modules/page.tsx` (121 lines)
- `src/app/admin/page.tsx` (141 lines)
- `src/app/admin/people/page.tsx` (116 lines)
- `src/app/admin/people/student-adder.tsx` (85 lines)
- `src/app/admin/requests/page.tsx` (18 lines)
- `src/app/admin/settings/page.tsx` (140 lines)
- `src/app/admin/structure/map-actions.ts` (37 lines) — Auto-map: place many existing venues at once on the building outlines/points chosen by the admin.
- `src/app/admin/structure/outline-all.tsx` (131 lines) — Outlines every venue automatically from OpenStreetMap building footprints, with
- `src/app/admin/structure/page.tsx` (84 lines)
- `src/app/admin/timetable/import-actions.ts` (305 lines) — The institution always comes from the admin's own role, never from the form.
- `src/app/admin/timetable/page.tsx` (115 lines) — Fetching a batch from the university timetable site can take ~15 s.
- `src/app/admin/timetable/pdf-import.tsx` (117 lines)
- `src/app/admin/timetable/source-import.tsx` (115 lines) — Collect classes from the institution's own timetable source, set up by
- `src/app/api/health/route.ts` (23 lines) — For an uptime monitor (e.g. UptimeRobot, every 5 minutes): 200 when the app and
- `src/app/api/push/dispatch/route.ts` (28 lines) — Called every minute by pg_cron (supabase/push-schedule.sql) to send class
- `src/app/api/roster/route.ts` (48 lines) — For an institution's own student system: POST the roster here with the API key
- `src/app/api/route/route.ts` (69 lines) — Walking directions for "Find my class".
- `src/app/auth/callback/route.ts` (19 lines) — Email confirmation and password-reset links land here with a one-time code.
- `src/app/dashboard/page.tsx` (15 lines) — Sends each user to their highest-privilege area. With no role yet, onboarding.
- `src/app/data-actions.ts` (58 lines) — A person asks about their own information (deletion, correction, objection).
- `src/app/early-warning-actions.ts` (63 lines) — Early warning (migration 0015). Permissions are enforced in the database:
- `src/app/error.tsx` (23 lines) — Shown when a page fails on the server, e.g. Supabase is unreachable.
- `src/app/globals.css` (85 lines) — UniAttend: navy and white, with a bright accent blue for highlights and charts.
- `src/app/layout.tsx` (27 lines) — System font stack (see globals.css): no font download at build time or on a
- `src/app/lecturer/actions.ts` (180 lines)
- `src/app/lecturer/disputes/page.tsx` (70 lines) — RLS already limits both lists to modules this lecturer teaches.
- `src/app/lecturer/early-warning/page.tsx` (38 lines)
- `src/app/lecturer/layout.tsx` (12 lines)
- `src/app/lecturer/modules/[id]/export/route.ts` (26 lines) — The report comes from module_report(), which refuses anyone who does not
- `src/app/lecturer/modules/[id]/page.tsx` (98 lines)
- `src/app/lecturer/page.tsx` (130 lines)
- `src/app/lecturer/sessions/[id]/controls.tsx` (69 lines) — Pause or resume, regenerate, change the window, allow a printed QR, and the card scanner.
- `src/app/lecturer/sessions/[id]/late-arrivals.tsx` (102 lines)
- `src/app/lecturer/sessions/[id]/live.tsx` (78 lines) — Re-fetches a freshly signed token at each 20-second step boundary. The QR
- `src/app/lecturer/sessions/[id]/page.tsx` (105 lines) — allow_printed_qr needs database update 0016; older databases still load.
- `src/app/lecturer/sessions/[id]/print/page.tsx` (58 lines) — A printable / downloadable fixed QR for one session (only when the location check is on).
- `src/app/lecturer/sessions/[id]/print/print-button.tsx` (4 lines)
- `src/app/lecturer/sessions/[id]/register.tsx` (240 lines) — The lecturer's register: search, tap a status per student, bulk actions,
- `src/app/lecturer/sessions/[id]/scan/page.tsx` (26 lines)
- `src/app/lecturer/sessions/[id]/scan/scanner.tsx` (147 lines) — Beep: high for success, low for a problem. Silent if audio is blocked.
- `src/app/lecturer/timetable/calendar.ics/route.ts` (12 lines) — The lecturer's teaching timetable as a calendar file. ?all=1 includes classes taught by colleagues.
- `src/app/lecturer/timetable/page.tsx` (67 lines) — The lecturer's teaching week, with download and print.
- `src/app/not-found.tsx` (12 lines)
- `src/app/notifications/page.tsx` (141 lines)
- `src/app/onboarding/actions.ts` (31 lines)
- `src/app/onboarding/page.tsx` (41 lines)
- `src/app/page.tsx` (57 lines)
- `src/app/paia/page.tsx` (100 lines) — Manual required of every private body by section 51 of the Promotion of Access to
- `src/app/privacy/page.tsx` (147 lines) — Written to cover what POPIA section 18 says people must be told. Each
- `src/app/push-actions.ts` (96 lines) — Store this device's push subscription for the signed-in person (moves it from any previous account).
- `src/app/settings/actions.ts` (15 lines) — Leave an institution: all of your roles there stop. Its administrators can't add you back.
- `src/app/settings/app-lock-settings.tsx` (111 lines) — Turn the fingerprint / face app lock on or off for this device.
- `src/app/settings/my-data/route.ts` (22 lines) — "Download my data": everything UniAttend holds about the signed-in person (POPIA s 23).
- `src/app/settings/page.tsx` (122 lines)
- `src/app/student/actions.ts` (101 lines) — "queued": saved on the phone without signal, to be sent later (client only).
- `src/app/student/check-in/check-in.tsx` (275 lines)
- `src/app/student/check-in/page.tsx` (12 lines)
- `src/app/student/class/[id]/live-class.tsx` (143 lines) — Always South African time, so the server and the phone show the same clock.
- `src/app/student/class/[id]/page.tsx` (45 lines) — The student's live view of one class, from check-in until the class ends or the lecturer closes it.
- `src/app/student/dashboard-view.tsx` (277 lines) — The student dashboard's display, separate from its data loading (page.tsx).
- `src/app/student/history/page.tsx` (145 lines)
- `src/app/student/layout.tsx` (18 lines)
- `src/app/student/leave-button.tsx` (22 lines) — "I'm leaving": records the student's check-out time.
- `src/app/student/map/page.tsx` (71 lines) — Lecturer names need database update 0008; without it, load classes without them.
- `src/app/student/navigate/navigator.tsx` (208 lines) — Metres left along the route from segment `seg` (starting at point p) to the end.
- `src/app/student/navigate/page.tsx` (32 lines)
- `src/app/student/page.tsx` (82 lines) — Monday (SAST) of the week containing this date, as YYYY-MM-DD.
- `src/app/student/timetable/calendar.ics/route.ts` (12 lines) — The student's timetable as a calendar file (Google, Outlook, Apple Calendar).
- `src/app/student/timetable/page.tsx` (59 lines)
- `src/app/student/trend-card.tsx` (80 lines) — Weekly attendance as a line, per module or overall; tap a point for its numbers.
- `src/app/super/actions.ts` (79 lines) — requireRole("super_admin") is the page gate; the RPCs re-check is_super_admin()
- `src/app/super/directory/[id]/page.tsx` (74 lines)
- `src/app/super/directory/page.tsx` (50 lines)
- `src/app/super/institutions/[id]/page.tsx` (86 lines) — Word overlap, to suggest the directory entry that matches a registration.
- `src/app/super/layout.tsx` (16 lines)
- `src/app/super/page.tsx` (108 lines)
- `src/app/super/plans/page.tsx` (38 lines)
- `src/app/super/requests/page.tsx` (18 lines)
- `src/app/super/setup-actions.ts` (162 lines)
- `src/app/super/source-fields.tsx` (20 lines) — Timetable source fields, shared by the directory and institution setup pages.
- `src/app/terms/page.tsx` (80 lines) — Plain-language terms for people who use UniAttend through their institution.

### `src/components/`

- `src/components/alert-actions.tsx` (44 lines) — Follow-up buttons for one alert. The note is used by "Add note" and required by "Dismiss".
- `src/components/app-chrome.tsx` (115 lines) — The student app's phone-style chrome: a big page title with the avatar beside it,
- `src/components/app-lock.tsx` (102 lines) — Covers the signed-in app until the device confirms its owner (fingerprint,
- `src/components/captcha.tsx` (39 lines) — Bot protection for sign-up, sign-in and password reset (Cloudflare Turnstile,
- `src/components/charts.tsx` (149 lines) — Dependency-free SVG charts, rendered on the server. Each one has a text
- `src/components/company-mark.tsx` (13 lines) — "UniAttend is a product of …": the operating company, as the legal pages and footer show it.
- `src/components/data-requests.tsx` (60 lines) — Personal-information requests, with the 30-day clock and a form to record the outcome.
- `src/components/early-warning.tsx` (81 lines) — Every alert the signed-in user may see in this institution (admins: all, lecturers: their modules).
- `src/components/feature-off.tsx` (10 lines) — Shown on a page whose feature the institution has switched off on the Design page.
- `src/components/form.tsx` (32 lines) — A form bound to a server action that reports errors and success inline.
- `src/components/icons.tsx` (51 lines) — A small stroke icon set (24px grid, lucide-style), inline so there is no icon
- `src/components/late.tsx` (44 lines) — Late-arrival pieces shared by the student check-in result and the lecturer register.
- `src/components/map/campus-map.tsx` (253 lines) — Campus map for students: every venue, what is on in it today (their own
- `src/components/map/campuses-editor.tsx` (162 lines) — Edit a list of campuses on a map. The chosen campus is placed by clicking
- `src/components/map/use-leaflet.ts` (65 lines) — Creates a Leaflet map in `ref` once the library has loaded (it touches
- `src/components/map/venue-editor.tsx` (275 lines)
- `src/components/map/venue-map.tsx` (52 lines) — Read-only map of one venue, optionally with the viewer's own position.
- `src/components/native-reminders.tsx` (57 lines) — In the UniAttend Android app (Capacitor), class reminders are scheduled on the
- `src/components/nav.tsx` (55 lines) — The longest matching prefix wins, so /lecturer/modules/x highlights
- `src/components/offline-sync.tsx` (104 lines) — Shows when the device is offline, how much is waiting to be sent, and sends it
- `src/components/push-toggle.tsx` (259 lines) — Inside the Android app (Capacitor): Android's own notification permission.
- `src/components/row-actions.tsx` (42 lines) — Small delete button with a confirmation step and an inline result.
- `src/components/shell.tsx` (149 lines) — eslint-disable-next-line @next/next/no-img-element -- institution logo from an admin-set https URL
- `src/components/timetable-actions.tsx` (17 lines) — "Add to my calendar" (.ics download) and "Print / save as PDF".
- `src/components/ui.tsx` (129 lines)
- `src/components/week-grid.tsx` (54 lines) — Today as ISO weekday (1 = Monday) in South African time.

### `src/lib/`

- `src/lib/app-lock.ts` (143 lines) — App lock: after signing in once with a password, the app can be reopened with
- `src/lib/assignment-match.ts` (210 lines) — Reads "which lecturer teaches which module" out of rows of cells from any document
- `src/lib/auth.ts` (53 lines)
- `src/lib/brand-cookie.ts` (3 lines) — Which institution's look the sign-in pages wear on this device (slug or id; not a secret).
- `src/lib/branding.ts` (28 lines) — The institution branding for the sign-in, registration and password pages,
- `src/lib/building-match.ts` (44 lines) — Matches timetable building names ("E-BLOCK", "NATURAL SCIENCE") to named
- `src/lib/campus-schema.ts` (16 lines) — A campus as the super admin edits it (directory entries and institution setup).
- `src/lib/campuses.ts` (126 lines) — Campus geometry helpers. Nothing about any institution is hard-coded: each
- `src/lib/csv.ts` (44 lines) — CSV with formula-injection protection: a cell beginning with = + - @ tab or CR
- `src/lib/dashboard.ts` (98 lines)
- `src/lib/data-manager.ts` (103 lines) — The admin Data page: one table per kind of record, with search, archived view,
- `src/lib/data-requests.ts` (22 lines) — Requests this admin may see (RLS decides), with the requester's name.
- `src/lib/doc-rows.ts` (132 lines) — Turns an uploaded document into rows of cells, whatever its format:
- `src/lib/early-warning.ts` (93 lines) — Early warning (migration 0015): shared types and wording for the admin and lecturer pages.
- `src/lib/env.ts` (21 lines) — Only public values live here. The service-role key is never read by the app:
- `src/lib/evidence.ts` (66 lines) — Client-side evidence collection. Everything here is *input* to the server's
- `src/lib/geo.ts` (60 lines) — Small geometry helpers for the live map and walking navigation.
- `src/lib/ics.ts` (73 lines) — A weekly timetable as an iCalendar (.ics) file: each class becomes a weekly
- `src/lib/integrations/datasets.ts` (208 lines) — What each kind of academic data looks like to UniAttend, whatever the source calls
- `src/lib/integrations/roster.ts` (125 lines) — The one shape every source is turned into before it reaches the database
- `src/lib/integrations/runner.ts` (79 lines) — The sync worker. The database decides what is due and hands over one connection
- `src/lib/integrations/secrets.ts` (60 lines) — Credentials for an institution's systems (Moodle tokens, roster-link tokens, OAuth
- `src/lib/integrations/sources.ts` (99 lines) — Talking to an institution's own systems. Every request: https only, public
- `src/lib/legal.ts` (40 lines) — The company details every legal page uses: the privacy notice, terms, PAIA manual
- `src/lib/nav-config.ts` (66 lines) — Every menu in the app, with the defaults an institution starts from. The Design
- `src/lib/offline-queue.ts` (59 lines) — Work done without signal, kept on the phone until it can be sent.
- `src/lib/palette.ts` (5 lines) — Module colours in the minimal graphite look: dark-to-mid greys that stay readable
- `src/lib/push.ts` (88 lines) — Delivers queued notifications to phones and browsers with Web Push.
- `src/lib/route.ts` (12 lines) — What /api/route returns. `from`/`to` are indexes into `line` (OpenRouteService way_points).
- `src/lib/safe-redirect.ts` (18 lines) — Where to send someone after sign-in or an email link. Only paths on this
- `src/lib/shell-data.ts` (35 lines) — The institution's theme; the older brand colour setting still applies until a theme is designed.
- `src/lib/stats.ts` (43 lines) — Small helpers for dashboards. All inputs are real rows; nothing is invented.
- `src/lib/student-data.ts` (27 lines) — Timetable slots for the modules the signed-in student is enrolled in (RLS-scoped).
- `src/lib/supabase/client.ts` (14 lines) — Browser client for Realtime subscriptions. Uses the public anon key only.
- `src/lib/supabase/cookies.ts` (19 lines) — How long the sign-in is remembered. "Keep me signed in" (the default) keeps the
- `src/lib/supabase/resilient.ts` (26 lines) — auth.getUser() with one retry on network failure. A network failure is
- `src/lib/supabase/server.ts` (27 lines) — Supabase client bound to the signed-in user's session. RLS always applies.
- `src/lib/theme.ts` (148 lines) — An institution's look: colours, shape, header, sidebar, footer, an
- `src/lib/timetable-export.ts` (61 lines) — Today as a SAST calendar date (UTC midnight of that date).
- `src/lib/timetable-pdf.ts` (261 lines) — Parser for timetable PDFs exported by university "Timetable
- `src/lib/timetable-sources.ts` (182 lines) — Where an institution's timetable is collected from. Set per institution by
- `src/lib/url-safety.ts` (35 lines) — Checks for any URL the server fetches on an administrator's behalf: https
- `src/lib/venue-outline.ts` (91 lines) — Gives every venue an outline: the OpenStreetMap building it is in, the building
- `src/lib/viewer-events.ts` (41 lines) — Converts events from a "timetable viewer" JSON API (one in use in South
- `src/lib/zip.ts` (54 lines) — A small ZIP reader for .xlsx and .docx uploads. Reads the central directory,

### `src/`

- `src/instrumentation.ts` (36 lines) — Server errors, sent to a chat channel so someone hears about them.
- `src/middleware.ts` (59 lines) — Machine endpoints that check their own secret.

### `public/`

- `public/manifest.webmanifest` (14 lines)
- `public/sw.js` (94 lines) — UniAttend service worker: shows push notifications and opens the right page when

### `scripts/`

- `scripts/bundle-sql.mjs` (27 lines) — Concatenates supabase/migrations into one transactional script for the
- `scripts/mobile-assets.mjs` (36 lines) — Draws the Android launcher icons and splash screens from the UniAttend mark.
- `scripts/mobile.mjs` (40 lines) — Builds the UniAttend Android app.
- `scripts/web-icons.mjs` (18 lines) — Draws the web app icons used by the manifest and push notifications.

### `tests/db/`

- `tests/db/early-warning.test.ts` (210 lines) — Early warning (migration 0015): alerts open by themselves when attendance
- `tests/db/harness.ts` (88 lines) — Runs the real migrations against an in-process Postgres (PGlite) with a
- `tests/db/install-script.test.ts` (30 lines) — The bundled SQL-editor script must install cleanly next to another app's
- `tests/db/location.test.ts` (90 lines) — Campus boundaries and class navigation (migration 0013). Live location sharing
- `tests/db/platform.test.ts` (1189 lines) — UNIVEN, roughly. Offsets of 0.005° latitude are ~550 m.
- `tests/db/safeupdate.test.ts` (49 lines) — Supabase loads pg_safeupdate for API requests: an UPDATE or DELETE without a
- `tests/db/security.test.ts` (78 lines) — Regression tests for the 2026-11-10 security review:

### `tests/unit/`

- `tests/unit/assignment-match.test.ts` (70 lines)
- `tests/unit/auth-cookies.test.ts` (14 lines)
- `tests/unit/building-match.test.ts` (35 lines) — Real building names from OpenStreetMap on a South African campus (2026-11-09).
- `tests/unit/csv.test.ts` (32 lines)
- `tests/unit/datasets.test.ts` (70 lines) — What nothing uses is reported, not silently dropped.
- `tests/unit/doc-rows.test.ts` (56 lines) — A minimal ZIP writer (CRC left as 0: the reader doesn't check it).
- `tests/unit/early-warning.test.ts` (23 lines)
- `tests/unit/geo.test.ts` (41 lines)
- `tests/unit/ics.test.ts` (33 lines) — 2026-11-11 is a Wednesday (ISO 3)
- `tests/unit/integration-secrets.test.ts` (58 lines) — A new random IV each time: the same secret never looks the same twice.
- `tests/unit/nav-config.test.ts` (35 lines)
- `tests/unit/roster.test.ts` (84 lines)
- `tests/unit/safe-redirect.test.ts` (30 lines) — 2. Open redirect: "next" must always stay on this site.
- `tests/unit/theme.test.ts` (31 lines)
- `tests/unit/timetable-pdf.test.ts` (98 lines)
- `tests/unit/url-safety.test.ts` (20 lines)
- `tests/unit/venue-outline.test.ts` (49 lines) — A ~40 m square building and a second one ~200 m east.
- `tests/unit/viewer-events.test.ts` (29 lines)

### `supabase/functions/`

- `supabase/functions/paystack-webhook/index.ts` (78 lines) — Paystack webhook → payments + subscription renewal.

### `mobile/`

- `mobile/app.json` (5 lines)
- `mobile/www/app.css` (11 lines) — { box-sizing: border-box; }
- `mobile/www/index.html` (16 lines)
- `mobile/www/offline.html` (25 lines)

### `loadtest/`

- `loadtest/checkin.js` (189 lines) — UniAttend attendance check-in load test (k6). STAGING ONLY.
- `loadtest/lib/config.js` (67 lines) — Shared configuration and the production guard for every UniAttend k6 script.
- `loadtest/lib/identity.js` (88 lines) — Deterministic identities shared with loadtest/seed/seed-staging.sql, JWT
- `loadtest/lib/scenarios.js` (30 lines) — Scenario shapes shared by the registration and check-in tests.
- `loadtest/registration.js` (94 lines) — UniAttend registration load test (k6). STAGING ONLY.
- `loadtest/seed/cleanup-staging.sql` (20 lines)
- `loadtest/seed/seed-staging.sql` (139 lines)
- `loadtest/sql/reset-run.sql` (18 lines)
- `loadtest/sql/validate-checkins.sql` (48 lines)

### `tools/`

- `tools/device-check/capacitor.config.ts` (11 lines) — The Android app bundles the built web app (dist/) inside the APK, which is
- `tools/device-check/index.html` (13 lines)
- `tools/device-check/package-lock.json` (2224 lines)
- `tools/device-check/package.json` (35 lines)
- `tools/device-check/src/App.tsx` (68 lines)
- `tools/device-check/src/components/BluetoothCard.tsx` (91 lines)
- `tools/device-check/src/components/Card.tsx` (49 lines)
- `tools/device-check/src/components/GpsCard.tsx` (127 lines)
- `tools/device-check/src/components/MapCard.tsx` (138 lines) — OpenStreetMap tiles through Leaflet: Google-Maps-style pan/zoom with no API
- `tools/device-check/src/components/NotificationCard.tsx` (138 lines) — High-importance channel: heads-up banner, default notification sound, vibration.
- `tools/device-check/src/components/WifiCard.tsx` (71 lines) — Live updates: Wi-Fi turning on/off or switching networks.
- `tools/device-check/src/lib/deviceStatus.ts` (50 lines) — Bridge to the small native module in
- `tools/device-check/src/lib/deviceStatusWeb.ts` (75 lines) — Browser version of the native module. Browsers deliberately hide Wi-Fi and
- `tools/device-check/src/lib/platform.ts` (22 lines) — Result of one check, shown as a coloured pill.
- `tools/device-check/src/lib/sound.ts` (36 lines) — Short two-tone chime generated with the Web Audio API, so the app can prove
- `tools/device-check/src/main.tsx` (11 lines)
- `tools/device-check/src/styles.css` (118 lines)
- `tools/device-check/tsconfig.json` (17 lines)
- `tools/device-check/vite.config.ts` (10 lines) — localhost counts as a secure context, so notifications, geolocation and

