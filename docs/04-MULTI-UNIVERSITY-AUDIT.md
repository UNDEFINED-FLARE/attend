# Multi-university SaaS: Phase 1 audit

Branch: `saas-multi-university` · Date: 12 Nov 2026 · Read-only: nothing in the database or on `main` was changed.

## 1. The most important finding: two different apps

The brief names tables such as `aa_profiles`, `aa_attendance` and `aa_windows`. Those exist, but they are **not UniAttend**. The Supabase project holds several apps:

| Schema / tables | What it is | Size |
|---|---|---|
| `uniattend.*` (49 tables) | **UniAttend**, this repository. Already multi-institution. | 3 institutions, 21 students, 5 lecturers, 12 sessions, 192 attendance records, 716 modules, 2,184 timetable rows |
| `public.aa_*` (12 tables) | An **older, separate attendance prototype** (sound-based "windows", "submissions", "device keys"). No code for it is in this repository. Last used 21–22 Oct 2026. | 24 people (21 students, 3 lecturers), 3 courses, 34 enrolments, 10 sessions, 24 attendance rows |
| `public.Products`, `listings`, `orders`, `sellers` | An unrelated marketplace | – |
| `public.units`, `unit_staff`, `stakeholders`, `venues` | Another unrelated app | – |

None of the 24 legacy `aa_*` users has a UniAttend account; one of its 3 course codes also exists in UniAttend.

**Consequence:** the brief's goal (a multi-university platform with tenant isolation) is largely **already built** in the `uniattend` schema. Rebuilding it on the `aa_*` tables would mean redoing work on an older, smaller app. The plan below therefore extends UniAttend, and treats the `aa_*` data as legacy to **import into UniAttend under UNIVEN** (see §6), not as the base.

## 2. What UniAttend already has (evidence)

| Brief requirement | Status | Evidence |
|---|---|---|
| Central `institutions` table | Done (partly different field names) | `id, name, slug, short_name, status, country, timezone, brand_primary, logo_path, contact_email, theme…`; domains in `institution_domains`; academic years in `academic_periods` |
| Memberships per institution, several institutions per user | Done | `user_roles(user_id, institution_id, role, status)`, unique per user + institution + role |
| Platform admin separate from university admin | Done | `super_admin` must have no institution (`check ((role='super_admin') = (institution_id is null))`) |
| Faculty → department → module; venues, timetables, calendar | Done | foreign keys plus paired `(institution_id, id)` keys so a child can't point at another institution's parent |
| Student number unique **per institution** | Done | `unique (institution_id, student_number)` |
| Module code unique per institution | Done | `unique nulls not distinct (institution_id, code, academic_period_id)` |
| RLS on every table | Done | all 49 tables have RLS; tables with no policies (`session_secrets`, `push_config`, `acoustic_submissions`) are deny-all by design |
| Security-definer functions pin `search_path` | Done | none in `uniattend` or `public` is missing it |
| Anonymous access | Limited | only `public_branding` (sign-in look) and the secret-checked push endpoints |
| Service-role key in the frontend | None | no use of the key anywhere in `src/` |
| Suspension blocks attendance, keeps data | Done | `institution_can_operate()` checked by check-in and session functions; `set_institution_status` is platform-admin only |
| Institution onboarding | Done (basic) | `request_institution` → pending → platform admin approves on `/super`; trial plan created |
| CSV student import, repeatable, adds enrolments | Done | `import_students` (institution-scoped, upserts, enrols) |
| Storage per institution | Done for logos | `branding/<institution id>/…`, write policy checks admin of that folder |
| Audit log, corrections audited | Done | `audit_logs`, `write_audit`, register history, override evidence |
| Late handling, corrections, offline, exports, cancellation | Done | migrations 0010, 0014, 0016, 0020; `cancelled` session status; `/admin/data/export` |
| Hardcoded UNIVEN assumptions | None found | no "UNIVEN"/"Venda" in `src/` |

## 3. Security findings

**UniAttend (`uniattend`)**

1. **Membership without consent (medium).** `link_my_accounts()` links a signed-in user to any student or lecturer row that has their email, and gives them that role, even at a **pending** institution. Anyone can apply for an institution and immediately becomes its admin, so they could add a "lecturer" with someone else's email. That person gains a role there on their next sign-in. They see nothing of their real institution, but it breaks "users can't be added to an institution without authorisation". *Fix:* link only into active institutions, and use invitations the person accepts (Phase 7).
2. **Missing roles.** Only `super_admin`, `institution_admin`, `lecturer` and `student` exist. The brief adds `institution_super_admin`, `faculty_admin`, `department_admin`, `attendance_officer` and `auditor`, which need scoped policies (a faculty admin limited to their faculty, an auditor read-only).
3. **Indexes.** `institution_id` has no index on 8 tables: `attendance_disputes`, `attendance_evidence`, `institution_domains`, `lecturer_assignments`, `module_enrolments`, `notifications`, `payments`, `student_alert_events`.
4. **Lecturer CSV import** is row-by-row through the admin pages, with no `import_lecturers` function or import report.
5. **No invitations.** Admins and lecturers join by email match or by the platform admin.

**Legacy prototype (`public.aa_*`), outside this repository**

6. **Self-promotion to lecturer (high, if that app is still used).** `aa_profiles_insert` / `aa_profiles_update` only check `id = auth.uid()`, so any signed-in user can create or edit their own profile with `role = 'lecturer'`, then create courses (`aa_courses_insert`) and venues (`aa_venues_write`). This includes users of the other apps in this project.
7. `aa_venues_select` is `using (true)` and `aa_sessions_select` shows any session without a course: readable by every signed-in user of the project.
8. No institution concept at all: one global role per person, no `institution_id`.

**Other apps in the project (not ours, for awareness):** public buckets `project-evidence` and `activity-images` with no size limit; `orders` "anyone can create / look up"; `public.activity_geofence` callable anonymously.

## 4. Tests: what exists versus the brief's 14

| Brief test | Status today |
|---|---|
| 1 Data isolation | PASS: `tenant isolation (Institution A vs Institution B)` (PGlite, real RLS as `authenticated`) |
| 2 Authentication / memberships | PASS: "roles are granted, never claimed", unconfirmed email refused |
| 3 Both run sessions | PASS: attendance engine tests run sessions in A and B |
| 4 Same student number at both | **NOT TESTED**: fixtures use A001/B001; the constraint allows it, but no test proves it |
| 5 Same module code at both | PASS: both institutions use `CSC101` |
| 6 Lecturer permissions | PASS: lecturer A can't open B's session or message B's module |
| 7 Admin permissions | PASS: admin A can't read or write B |
| 8 Own attendance only | PASS |
| 9 Storage across tenants | **NOT TESTED**: PGlite has no Storage; the policy exists but is unverified |
| 10 Suspending one doesn't stop the other | **PARTIAL**: suspension is tested; "the other keeps working" is not asserted |
| 11 Forged UUIDs / institution ids | PASS: "a row in A cannot reference B's parent even with a forged id" |
| 12 RLS tested directly | PASS: all database tests run as the `authenticated` role |
| 13 Concurrency | **PARTIAL**: `loadtest/` (k6) exists; not run against two institutions at once |
| 14 Regression | PASS: 173 automated tests pass on `main` |

## 5. Proposed plan (each phase reported, tested and committed on this branch)

1. **Roles and memberships** (migration 0021): add the five roles. Scope faculty and department admins to their faculty or department, make auditors read-only, and let attendance officers correct attendance without managing people. Add policies and tests for each.
2. **Invitations** (0022): admins invite by email with a role; the person accepts; links happen only into active institutions (fixes finding 1). Add an institution switcher check, and tests.
3. **Institution fields and onboarding** (0023): `institution_code` (unique), secondary colour and academic year exposed in onboarding. Extend onboarding to collect domain, logo and first admin; activation, suspension and reactivation are already in place.
4. **Indexes and lecturer import** (0024): the 8 indexes, plus `import_lecturers` with a downloadable import report for students and lecturers.
5. **Missing tests:** overlapping student numbers, suspension isolation, storage policy test against the real project (read-only check), and a two-university concurrent load run.
6. **Legacy `aa_*` data** (only with your decision, see §6).
7. **Final report** with PASS / PARTIAL / FAIL / NOT TESTED for all 15 acceptance criteria and deployment steps.

Nothing is run on the live database without your go-ahead. Migrations are written to be safe to rerun, add columns rather than drop them, and come with a rollback note.

## 6. Decision needed: the legacy `aa_*` data

The legacy rows have no institution, so the brief's rule applies: *don't assign records to UNIVEN unless ownership is established.* Options:

- **A. Import into UniAttend under UNIVEN, flagging what's unclear.** Copy courses, enrolments, sessions and attendance into `uniattend` (keeping the original ids in a mapping table), mark them "imported, needs review", and leave `aa_*` untouched as a backup. People get linked when they sign in to UniAttend with the same email.
- **B. Leave it alone, but close the two security holes** (findings 6–7) with a small policy fix, so the old app can't be used to promote yourself.
- **C. Archive it.** Export the `aa_*` data to a file for UNIVEN's records and revoke access to those tables. Deleting them would only happen later, with your explicit approval.
