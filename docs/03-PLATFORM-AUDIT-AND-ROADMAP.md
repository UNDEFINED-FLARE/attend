# UniAttend platform audit and roadmap

Audit date: 11 November 2026. Covers `main` plus the `v2-improvements` branch (security fixes, location sharing,
walking directions, device-check tool), checked together: typecheck, lint, 135 tests and the production build pass.

This is Phase 1 of the master development brief: what exists, what is partial, what is missing, and a realistic
order to build the rest. Nothing here changes code.

## 1. Architecture: keep what works

The brief assumes "HTML, CSS and vanilla JavaScript". **UniAttend is already Next.js 15 + React 19 + TypeScript on
Vercel, with Supabase.** The brief's own rules say to preserve the existing stack and not replace working
functionality, so the plan keeps Next.js. Rewriting to vanilla JS would discard about 30 working screens and gain
nothing.

| Layer | Today |
|---|---|
| Hosting | Vercel (`main` deploys automatically) |
| App | Next.js App Router, server components and server actions; Tailwind v4 |
| Database | Supabase Postgres, own schema `uniattend`, 13 migrations, RLS on every table |
| Business rules | `SECURITY DEFINER` SQL functions (check-in, sessions, corrections, imports, reports, push queue) |
| Auth | Supabase Auth, email confirmation, roles granted by admins or by verified email links, never self-claimed |
| Realtime | Live lecturer register only (plus a 15 s poll) |
| Mobile | Capacitor Android app around the site; local class reminders |
| Notifications | In-app inbox + Web Push (VAPID), every-minute sender via pg_cron |
| Tests | Vitest unit tests + database tests on PGlite (RLS, tenancy, check-in, security, location) |

## 2. Module-by-module status

Legend: ✅ done · 🟡 partial · ⬜ missing

### A. Institution management, 🟡

| Item | Status | Notes |
|---|---|---|
| Independent tenant per institution, RLS isolation | ✅ | Tested: institution A cannot read or write B's rows |
| Name, logo, colours, header, footer | ✅ | Admin → Design |
| Email domains | ✅ | `institution_domains`, used to link student accounts |
| Campuses with map outlines | ✅ | Super admin set-up and directory |
| Faculties, departments, programmes | 🟡 | Tables exist; faculties and departments have UI; programmes have no UI |
| Academic years and semesters | 🟡 | `academic_periods` table, no UI, not linked to modules or sessions |
| Schools level | ⬜ | Recommend an optional `schools` level between faculty and department |
| Lecture periods (bell times) | ⬜ | |
| Attendance policies | 🟡 | Late minutes, accept score, required %, GPS rules and typed codes are per institution; not per faculty or module |

### B. Lecturer workspace, 🟡

| Item | Status |
|---|---|
| Dashboard: modules, sessions, attendance, items to review | ✅ |
| Module page: students, report, at-risk, CSV export, open session | ✅ |
| Live register, late arrivals, corrections with reason | ✅ |
| Lecturer adds or removes students, imports a CSV for their module | ⬜ (admin only today) |
| Lecturer creates modules (when permitted) | ⬜ |
| Module notes, academic year and semester on module | ⬜ |
| Upcoming sessions from the timetable on the module page | 🟡 |

### C. Attendance engine, 🟡 (strong core)

| Item | Status | Notes |
|---|---|---|
| Server-decided check-in: signed rotating QR (20 s), typed code, GPS probability, device hash, scoring | ✅ | |
| Duplicate prevention (DB unique + function) | ✅ | |
| Review queue, disputes, lecturer correction with reason, audit log | ✅ | |
| Late arrivals: minutes late, lecturer accepts or denies | ✅ | |
| Manual register with quick actions (mark all present, reset, save, finalise with confirmation) | 🟡 | One-at-a-time correction form; no bulk register |
| Configurable statuses (name, colour, counts as attended or absent, affects %) | ⬜ | Statuses are a fixed CHECK list today; needs an `attendance_statuses` table and report changes |
| "Left early" | ⬜ | Comes with time-out |
| QR download and print, set expiry, disable, regenerate | 🟡 | Live QR only. **A printed QR is a static code**: allow it only with GPS required, and label it weaker |
| Lecturer scans a student card (webcam, phone, USB scanner) | ⬜ | Needs a student card number or QR on `students` |
| Multiple check-ins per session, cooldown | ⬜ | Today one record per student per session |
| Time-in and time-out | ⬜ | |
| Correction history shown per record | 🟡 | Stored in `audit_logs` and `attendance_evidence`; not shown in the UI |

### D. Geofencing, ✅ mostly

Venue polygons or radius, accuracy limit, GPS required per institution, probability scoring, spoofing heuristic,
"never auto-absent" rule. **Missing:** a per-venue or per-session choice of "reject" or "flag", and per-module GPS
policy.

### E. Student portal, ✅ mostly

Dashboard (trend, ring, week, modules, recent), check-in with welcome screen, history with Today / Week / All,
disputes, timetable, campus map, directions, location sharing, notifications. **Missing:** module filter and
date range on history, a "My Modules" page with lecturers, monthly charts.

### F. Registration and onboarding, 🟡

| Item | Status |
|---|---|
| Student sign-up, linking by confirmed email or domain + student number | ✅ |
| CSV import, paste a list, add one student | ✅ |
| Import preview, duplicate detection, downloadable error report | 🟡 (summary only) |
| Lecturer onboarding: add, grant role, assign modules (also from a file) | ✅ |
| Activate or deactivate roles | ✅ (`set_role_status`) |
| Programme, faculty, department, year on the student record | 🟡 |

### G. Capacity, waitlists, temporary enrolments, ⬜

Only `modules.expected_students` exists. Needs `capacity`, a registration window, a `waitlist` table with positions
and notifications, and `enrolments.expires_at` with a daily job.

### H. Dashboards, 🟡

Student, lecturer, institution and platform dashboards exist and use real data. **Missing:** filters (year,
semester, campus, faculty, department, programme, module, date range) and pre-aggregated rollups for large
institutions.

### I. Reporting, 🟡

Module report (SQL) + CSV export. **Missing:** report centre, faculty, department, institution, daily, monthly,
absenteeism, late and verification reports; XLSX and PDF; branded headers; server-side pagination.

### J. Communication, 🟡

In-app inbox, Web Push, class reminders, announcements by audience (all, students, lecturers, admins).
**Missing:** faculty or department targeting, lecturer → module and lecturer → student messages, missed-lecture
and low-attendance alerts, an email/SMS provider interface with delivery status.

### K. Daily tracking, L. Gradebook, M. Front desk, ⬜

Not started.

### Super admin, 🟡

Overview, approve, suspend and reactivate, plans and subscriptions, directory and set-up. **Missing:** user search,
suspend or restore accounts, platform-wide audit view.

### Roles, 🟡

Super admin, institution admin, lecturer and student. **Missing:** faculty admin, department admin, auditor
(read-only). These need scoped permission helpers in RLS (`is_faculty_admin(faculty)`, etc.).

### Timetable, ✅ mostly

PDF (block and CELCAT), JSON viewer API and PDF-index sources, manual slots, clash checks, lecturer and venue
mapping. **Missing:** semester and year on slots, CSV import, "start attendance from this scheduled lecture".

### Commercial, 🟡

Plans, limits enforced in the database, subscriptions, Paystack webhook (now exactly-once). **Missing:**
checkout page, invoices, payment history UI, campus and storage limits.

## 3. Risks to fix before any large rollout

From `docs/capacity/10k-readiness-report.md` and this review:

1. **Email delivery:** Supabase's built-in email can't confirm accounts at scale. Configure custom SMTP (e.g. Resend).
2. **Auth rate limits:** all sign-ins pass through Vercel's servers; test the per-IP limits on staging.
3. **Load testing:** k6 scripts exist in `loadtest/`, but no test has been run yet.
4. **Location data:** live positions are kept up to 12 hours if the app is closed. Consider 30 to 60 minutes.
5. **Walking directions:** without `ORS_API_KEY` they fall back to a straight line. The free OpenRouteService
   quota is about 2,000 routes a day.

## 4. Roadmap (realistic order)

Each phase ends with migrations, RLS tests, end-to-end checks and a deploy. Sizes are rough working sessions.

| Phase | Scope | Size | Why this order |
|---|---|---|---|
| **2. Attendance engine** | Bulk register (mark all, reset, save, finalise with confirmation); configurable statuses incl. "left early"; correction history panel; QR download and print as a GPS-required static code; student card number + lecturer scanner (camera and USB); time-in and time-out; multiple check-ins with cooldown | 3–4 | Core value; everything else reports on it |
| **3. Academic structure + filters** | Programmes and academic year/semester UI; modules and sessions linked to a period; schools level; dashboard filters; rollup tables | 2 | Reports and dashboards need these dimensions |
| **4. Reporting centre** | Standard reports, custom builder, preview, CSV/XLSX/PDF with branding, pagination, background export for large files | 2–3 | Most requested by management |
| **5. Students and enrolment** | Import preview with error report; lecturer-managed enrolment; capacity, waitlists, temporary enrolments | 2 | |
| **6. Roles** | Faculty admin, department admin, auditor, with scoped RLS and tests | 1–2 | Needed before big institutions onboard |
| **7. Communication** | Targeted announcements; lecturer messages; missed and low-attendance alerts; email/SMS provider interface (needs a provider key) | 2 | |
| **8. Commercial** | Checkout, invoices, payment history, usage page; super admin user search and suspension; platform audit | 2 | Needs Paystack keys and approved pricing |
| **9. Optional modules** | Front desk check-in; daily tracking fields; gradebook (separately permissioned) | 3 | Lower priority for attendance; gradebook last |
| **10. Production readiness** | Custom SMTP, staging project, k6 load tests, RLS penetration tests, monitoring, backups | ongoing | Required before 10,000 students |

**Recommendation:** start Phase 2 with the bulk register and configurable statuses. That is the biggest visible gap
for lecturers, and statuses change how every report counts attendance, so they should come before reporting.

## 5. Needs from you

| Item | For |
|---|---|
| Run migrations 0012 and 0013 (after merging the branch) | Security fixes, location sharing |
| Custom SMTP credentials (Resend or similar) | Mass registration |
| `ORS_API_KEY` (optional) | Real walking routes |
| Paystack keys and approved prices | Checkout and invoices |
| Email/SMS provider choice | Phase 7 |
| A Supabase staging project | Load and security testing |
