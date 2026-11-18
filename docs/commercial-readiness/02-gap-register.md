# 02 — Gap register

*14 November 2026, `main` at `8f32c28`. Status words are defined in [01-technical-audit.md](01-technical-audit.md). "Tested" means automated tests only; no feature has yet been proven in a university pilot.*

Priority: **P0** blocks any real pilot · **P1** needed before a paid contract · **P2** needed to scale · **P3** later.

## Foundation and security

| Feature | Current status | Evidence | Required improvement | Priority | Acceptance criteria |
|---|---|---|---|---|---|
| Legacy `public.aa_*` role escalation | **Fixed live** 15 Nov 2026 | `supabase/legacy/aa-profiles-lockdown.sql` applied; verified with a rolled-back live test | Retire the prototype's grants when nobody uses it | P0 | A signed-in user's `update aa_profiles set role='lecturer'` leaves the role unchanged |
| Database shared with other apps | At risk | `public` holds marketplace, `acvosa` and `aa`/`uvn` tables; two foreign edge functions | Move UniAttend to its own Supabase project (paid plan) | P0 | Production project contains only `uniattend` objects |
| Dispatch secret reuse | At risk | push secret = a Supabase secret API key | Rotate the key; new random 32-byte dispatch secret in Vercel and `push_config` | P0 | Old key revoked; push and integration runs still work |
| Migration tracking | Implemented, tested; database live (0028 applied 15 Nov), app change deploys with the next push | 0028 adds `schema_versions`; `/api/health` compares it with the version the build expects | Run 0028 live; every new migration inserts its own version | P1 | One query lists applied UniAttend migrations; health turns degraded when the database is behind |
| Platform administrator's standing access to university records | Fixed, tested; live 15 Nov 2026 (0034) | `is_inst_admin()` is true for UniAttend staff only during an institution's support-access grant (1 h – 7 days, revocable, audited); explicit platform reads of lecturers, audit entries, roles, profiles and integration errors removed; 5 database tests; verified live (platform sees 0 students without a grant) | — | P1 | A platform administrator sees no student or attendance record without a grant (tested) |
| Multi-tenant isolation | Implemented, tested | `tests/db/security.test.ts`, `platform.test.ts` cross-institution cases | Add isolation tests for every new table (ongoing) | P0 | Zero cross-institution reads/writes in tests |
| Staging environment | Missing | One project only | Separate Supabase project + Vercel preview env | P0 | Migrations and load tests run on staging first |
| Backups and restore | Missing | Free plan; no PITR | Paid plan, PITR, documented and executed restore test | P0 | Restore of a copy succeeds within the stated RTO |
| Error monitoring and alerts | Partial | `/api/health` now also reports failed or late background jobs and a database behind the build (0028 live in the database; the app change deploys with the next push); optional `ALERT_WEBHOOK_URL` | Error tracking service; point an uptime monitor at `/api/health` | P1 | A forced error and a failed job each raise an alert |
| Transactional email (SMTP) | Not deployed | Supabase default mailer | Custom SMTP with a verified domain | P0 | Sign-up and reset mails arrive from the UniAttend domain |
| CAPTCHA / abuse protection | Implemented, not verified | Turnstile wired via `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Configure keys in Supabase Auth and Vercel | P1 | Sign-up refuses requests without a token |
| Leaked-password protection | Missing | Supabase advisor | Turn on in Auth settings | P1 | Advisor warning gone |

## Attendance

| Feature | Current status | Evidence | Required improvement | Priority | Acceptance criteria |
|---|---|---|---|---|---|
| Rotating signed QR, replay window | Implemented, tested | `session_secrets`, attendance engine tests | Real-device test in a lecture hall | P0 | ≥95% successful check-ins in pilot |
| Enrolment, duplicate, device checks | Implemented, tested | `check_in` function and tests | — | P0 | Zero accepted duplicates in tests and pilot |
| Venue geofence | Implemented, tested | `location.test.ts` | Report GPS accuracy as evidence, not a verdict | P1 | Low-accuracy fixes go to review, not absent |
| Late arrivals with lecturer decision | Implemented, tested | migration 0010, tests | — | P1 | — |
| Exception review queue (all failure reasons) | Implemented, tested; live 15 Nov 2026 (0029) | `review_queue`, `decide_review`; lecturer Reviews page and admin `/admin/review`; 5 database tests | Attendance-officer role later; pilot use | P1 | Each case shows its reason and evidence; every decision keeps who, what and why |
| States "pending review" and "not recorded" | Implemented, tested; live 15 Nov 2026 (0029) | Pending review existed; a refused attempt now becomes pending review at close, not absent; `missing_registers` lists classes with no register | Pilot use | P1 | Uncertain check-ins never become absent automatically |
| Offline check-in queue | Implemented, tested (unit) / untested on phones | migration 0020 | Real Android test | P1 | Queued check-in validated on reconnect; duplicates refused |
| Open attendance from a dated class | Implemented, tested | 0027, 7 database tests | Pilot use | P0 | One session per class however many times opened |
| Register, corrections with reasons | Implemented, tested | migration 0014 | — | P1 | — |

## Integrations

| Feature | Current status | Evidence | Required improvement | Priority | Acceptance criteria |
|---|---|---|---|---|---|
| Sync engine (stage → commit → report) | Implemented, tested | 0025, database tests | Pilot dataset | P0 | Re-imports create no duplicates; failures leave data unchanged |
| Import Centre (CSV/Excel, mapping, preview) | Implemented, tested | `/admin/integrations/import`, `datasets.test.ts` | Pilot with real exports | P0 | 100% correct matching on pilot dataset |
| Integration Centre dashboard, catalogue, wizard, log | Implemented, untested in pilot | `/admin/integrations` | — | P1 | Status only "connected" after a server-side test passes |
| Moodle connector | Implemented, **blocked** | `src/lib/integrations/sources.ts` | Needs a real Moodle and token | P1 | Courses and enrolments synced from a real Moodle |
| Scheduled CSV/JSON link | Implemented, tested | `fetchRosterFeed`, SSRF tests | — | P1 | — |
| Institution-pushed API | Implemented, tested; live 15 Nov 2026 (0033) | `/api/v1/roster` with Idempotency-Key, `/api/v1/status`, `/api/v1/runs/{id}`, one error format with request ids; public docs at `/developers`; 4 database and 4 unit tests | First real caller | P1 | Documented, versioned, idempotent |
| Configurable REST connector (paths, pagination, OAuth) | Implemented (17 Nov 2026), not run against a real API | `src/lib/integrations/rest.ts`, `readRest` in `sources.ts`, migration 0035; `tests/unit/rest-connector.test.ts` | Run against one university's test API | P2 | Paged JSON source synced with mapping |
| ITS, Banner, PeopleSoft, Blackboard, CELCAT | **Blocked** | Listed as "not available yet" in the catalogue | Authorised test environment from a university | P2 | Tested against a real system before being shown as available |
| Complete-dataset reconciliation rules | Partial | `complete` flag on roster pushes | Per-dataset rule and admin review before removals | P1 | Nothing removed from an incomplete import |
| Two integration code paths | Debt | roster connections (0024) and engine (0025) | Converge on the engine | P2 | One code path |

## Timetable

| Feature | Current status | Evidence | Required improvement | Priority | Acceptance criteria |
|---|---|---|---|---|---|
| Dated classes from weekly slots | Implemented, tested; live | 0027, 4,366 live events; first nightly run succeeded 14 Nov 23:00 UTC | — | P0 | Nightly job succeeds |
| Cancel, move, venue, substitute, attendance on/off | Implemented, tested | `change_event` | — | P1 | Students in the group notified |
| Lecture groups | Implemented, tested | `group_name` on enrolments and events | Group import from SIS | P1 | — |
| Source-of-truth / conflict policy for imported timetables | Partial | Hand edits are never overwritten | Configurable policy + audit of conflicts | P2 | Conflicts listed for review |
| Merged and split classes, extra classes, exams | Partial | One-off events can be imported; no merge/split UI | Add when a pilot needs it | P3 | — |

## Roles and reporting

| Feature | Current status | Evidence | Required improvement | Priority | Acceptance criteria |
|---|---|---|---|---|---|
| Super admin, institution admin, lecturer, student | Implemented, tested | `user_roles` check constraint | — | P0 | — |
| Faculty admin, department admin | Implemented, tested; live 15 Nov 2026 (0030) | Scoped by `user_roles.faculty_id` / `department_id`; `may_view_module`, `may_correct_module`; `/staff` area | Pilot use | P1 | Cannot see another faculty in tests (passing) |
| Attendance officer, integration admin, auditor | Implemented, tested; live 15 Nov 2026 (0030) | Officer: all attendance, reviews, corrections; integration admin: connection, import and sync functions only; auditor: read-only incl. audit log and role list | Pilot use | P1 | Permission test suite covers each (6 tests, passing) |
| Institution reports | Implemented, tested; live 15 Nov 2026 (0031) | `institution_report()`: totals, by faculty, department and module, weekly trend, students at risk (worst case or 3+ absences in a row), missing registers, open disputes; pages for admins, staff and lecturers; 6 database tests | Pilot use; speed up for large universities (about 1 s for 719 modules) | P1 | Aggregated in the database; each person sees only their modules (tested) |
| CSV export | Implemented; audit trail tested; database live, app change deploys with the next push | Admin data export, module report, rejected rows and personal-data download each call `log_export` (0028) before sending | Run 0028 live | P1 | Every export appears in the institution's audit log with who, what and row count |
| Excel and PDF export | Implemented, tested; branded PDFs and Excel deployed 15 Nov 2026 | Excel built in (`src/lib/xlsx.ts`, no dependency, never writes formulas; 4 unit tests); PDF through a print page and the browser's Save as PDF; every download audited | Open a sample in Excel and LibreOffice during the pilot | P2 | Workbook opens in Excel; downloads appear in the audit log |

## Commercial, legal and mobile

| Feature | Current status | Evidence | Required improvement | Priority | Acceptance criteria |
|---|---|---|---|---|---|
| Plans, trials, manual billing | Partial | 0022; prices not set; Starter allows 15,000 modules but Professional 2,000; feature flags do not gate the new reports, exports and roles | Set prices, fix limits, decide what each plan includes | P1 | Each plan's price and limits are consistent and enforced |
| Paystack payments | **Not deployed** | Webhook function absent; 0 payments | Deploy and verify webhook in test mode | P2 | Payment only recorded after server verification |
| Institution onboarding | Implemented, tested; live 15 Nov 2026 (0032) | Twelve-step go-live checklist: data-driven steps tick themselves; policy and training signed off by the institution; verification and go-live by UniAttend; go-live refused until every step is done; 3 database tests | First real onboarding | P1 | New university onboarded without code changes |
| Support desk | Missing | — | Tickets, priority, assignment | P2 | — |
| Data export and institution exit | Implemented, tested; live 15 Nov 2026 (0032) | Full export (31 tables as CSV in a ZIP, credentials never included, audited); revoke all integration credentials; exit request → UniAttend closes (archived, nothing deleted); 4 database tests | Try a full export of a large institution (60 s limit) | P1 | Export of every table the institution owns |
| Legal documents | Partial, **blocked** | `docs/legal/*`, public pages | Information Officer named; attorney review | P0 | Signed operator agreement with the pilot university |
| Android release build | Missing | Debug APK only | Signed release, Play internal testing | P1 | Installable release build |
| Real-device testing | Missing | — | Test matrix incl. budget phones | P0 | Report in `08-mobile-test-report.md` |
| Load tests | Implemented, **not run** | `loadtest/` (k6), needs staging | Run on staging | P1 | Results in `07-load-test-report.md` |
