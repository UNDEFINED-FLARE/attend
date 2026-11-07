# UniAttend — Phase 1 Technical Audit

Audit date: 2026-11-07. Auditor: Claude (on behalf of the UniAttend owner).

## 1. What exists, and where

UniAttend was never in one repository. The sources found on this machine:

| Location | What it is | Last change | Verdict |
|---|---|---|---|
| `Downloads/uniattends1-main.zip` → `univen.html` (6,280 lines), `univen-react.html` (3,873 lines) | **The newest production app.** Single-file HTML/JS. Originally written against Firebase Realtime DB; ported to Supabase through a shim that emulates `db.ref(path)` in 54 call sites. Deployed on Vercel as a static site. | 2026-09-18 | Feature reference. Not a maintainable base. |
| `Downloads/attendance-supabase/` | React 18 + Vite app. Ambient acoustic attendance. `supabase/migrations/schema.sql` (571 lines) is the cleanest SQL in the project. | 2026-09-06 | **Best code in the project. Preserve the DSP, matcher, RLS approach and report arithmetic.** |
| `Downloads/ambient-attendance/`, `Downloads/attendance/` | Node/Express prototypes of the same acoustic pipeline, with a simulated-room bench. | 2026-09-06 | Superseded by `attendance-supabase`. |
| `Downloads/Mobile Devices/UniAttend/` | Early Vite prototype. | 2026-08-15 | Superseded. |
| `BF/attend.html` (in BF git history) | Earliest single-page version. | — | Superseded. |
| Supabase project `acvosa` (`rbnnbmduwrvokhbkezyh`) | Live backend of `univen.html`. Holds `aa_*` tables. | — | **Could not be inspected** — the read-only MCP user fails auth on this project. Its schema is reconstructed below from client code. Treat as production data: do not migrate over it without a backup. |

## 2. Features that exist today

From `univen.html` and `attendance-supabase`:

- **Accounts**: Supabase email/password. Roles `student` / `lecturer` in `aa_profiles.role`, set from signup metadata (self-assigned — see S1).
- **Courses, enrolment** by student number (`aa_enrol_by_number`), bulk roster paste.
- **Class sessions** with a 6-char join code (unambiguous alphabet), register seeded from roster on open (`aa_open_class_session`), close.
- **QR**: rotating code every 30 s, rendered with `qrcodejs`, scanned with `html5-qrcode`.
- **GPS**: multi-sample robust fix, polygon/radius containment *probability* (not a hard cut), spoof heuristics (identical-accuracy streams, impossible jumps), "room consensus" against other students' fixes, campus walk-to-map polygon recorder (Leaflet).
- **Device**: random device ID in `localStorage`; flags one device checking in two students.
- **Ambient acoustic verification** (the novel part): on-device FFT → landmark hashes; only integer hashes uploaded; server pairwise matching with offset-histogram alignment, clustering anchored on the lecturer's device; fingerprints deleted after analysis; no client can SELECT a fingerprint, not even its own. Bench + e2e test harness.
- **Fusion**: GPS/QR verdict combined with acoustic evidence into a `fused` verdict.
- **Reflections**: optional minimum-word reflection at check-in.
- **Overrides**: lecturer corrections only through `aa_override_attendance`, which sets audit fields server-side.
- **Reports**: `aa_course_report` — percentage over *resolved* sessions, plus `worst_case_percent`. This rule (inconclusive evidence ≠ absence) is correct and fair, and the new platform keeps it.
- **Exports**: CSV, XLSX (SheetJS), PDF (jsPDF + autotable). Charts (Chart.js).
- **Venues, timetables, notifications** tables (`aa_venues`, `aa_timetables`, `aa_notifications`).
- Realtime on attendance/windows/sessions.

## 3. Security findings

| # | Severity | Finding | Where | Fix in new platform |
|---|---|---|---|---|
| S1 | **Critical** | Role is self-assigned at signup: `aa_role` from user metadata goes straight into `aa_profiles.role`. Anyone can register as a lecturer. | `aa_handle_new_user` | Roles live in `user_roles`, writable only by institution admins / super admins via definer functions. Signup always creates a student-less, role-less profile. |
| S2 | **Critical** | The student's browser decides its own status: `aa_check_in(p_status => 'present' \| 'review', p_gps, p_verification…)`. GPS verdict is computed client-side. | `univen.html:2034` | Client sends raw evidence only (token, GPS samples, device hash). Server computes status. |
| S3 | **High** | QR token generated with `Math.random()` in the lecturer's browser and stored as `live_token`; validated by comparing strings. Predictable, not signed, no replay record. | `univen.html:4925` | HMAC-signed tokens minted server-side, 20 s life, step-indexed, per-student single use enforced by the unique `(session, student)` constraint. |
| S4 | High | No institution concept. All lecturers and students share one namespace; student numbers are globally unique. | schema | `institution_id` on every tenant row; RLS keyed on membership. |
| S5 | Medium | `aa_profiles_select` is a correlated subquery per row; fine at 30 students, slow at 30,000. | schema | Membership helper functions marked `stable`, indexed join columns. |
| S6 | Medium | Lecturer device computes the fused verdict and writes it back via `aa_set_fused`. A lecturer can be trusted to override, but it means verdicts are not reproducible. | `univen.html:6202` | Verification engine runs server-side; verdict + explanation stored in `attendance_verification_events`. |
| S7 | Low | 7 third-party CDN scripts without SRI. | `univen.html:2114` | Bundled npm dependencies. |
| S8 | Low | Device ID is a plain random value in localStorage, sent raw. | `univen.html:2433` | Client sends `SHA-256(institution_salt ‖ local id)`; raw ID never leaves the device. |

Good practice already present (kept): pinned `search_path` on every definer function; `EXECUTE` revoked from `PUBLIC`; fingerprint table with no SELECT policy; register seeded at session open; override-only status changes.

## 4. Broken or fragile

- `univen.html` depends on a hand-written Firebase emulation layer; behaviour differs subtly (transactions become RPCs, `.on()` becomes polling).
- `supabase/functions/` is empty in `attendance-supabase`: the `analyse-window` edge function the README describes is not on disk. `matcher.js` is, so the function can be rebuilt from it.
- The local `schema.sql` is older than the live DB (no venues, timetables, gps, fused, live_token columns).
- `attendance-supabase/.env` is present on disk; confirm it is in `.gitignore` before that folder is ever pushed.

## 5. Decision

Build the new platform in this repository (`UNDEFINED-FLARE/attend`) as a **new, multi-tenant schema** with no `aa_` prefix, in a **new Supabase project**. Do not migrate over `acvosa`. A one-off import from `aa_*` into the UNIVEN tenant is a later, separate step, after a backup (roadmap Phase 9).

Ported as-is (owner's own code): `fingerprint.js`, `matcher.js`, `capture.js`, the report arithmetic, the GPS robust-fix and containment-probability maths.

See `02-ROADMAP.md`.
