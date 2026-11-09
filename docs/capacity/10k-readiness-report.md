# UniAttend — 10,000-student production-readiness audit

Audit date: 2026-11-09. Scope: the repository at `main` (7f6e7e7) **plus the uncommitted working tree**, which includes
another session's late-arrival work (`20261109000010_late_arrivals.sql`, `late-arrivals.tsx`, etc.). That work was audited
as-is and not modified.

Method: read-only. I read every migration (0001–0010), the RLS policies, every server action and every page that queries the
database, the middleware, the Supabase clients and the Next.js config. I ran the existing PGlite suite (`npm run test:db`: **48/48
passed** on the current tree). I read two pieces of live metadata through read-only APIs (Supabase project details and the Vercel
project summary). I changed no data and no infrastructure, deployed nothing, and ran no load against any real environment.

> **No capacity figure in this document has been measured.** Every throughput or latency number below is either a target, a
> vendor limit, or an estimate derived from reading the code. The load tests in `loadtest/` have **not been run**, so all
> "Result" cells are marked **PENDING**.

Labels used throughout:

| Label | Meaning |
|---|---|
| **VERIFIED** | Confirmed by reading the code, by a passing test, or by a vendor document or API response I read in this audit. |
| **ASSUMPTION** | Plausible but untested; needs a staging load test or a dashboard check. |
| **CONFIRMED BOTTLENECK** | The code or configuration makes the problem certain at the stated scale. Only its exact threshold is unmeasured. |
| **RECOMMENDATION** | A proposed change. Nothing has been changed. |

Planning targets (from the owner): 10k registered students; 10k concurrent users; registration bursts of 1,000 in 5 min;
5,000–10,000 check-ins per minute; p95 < 500 ms for the API and < 1 s for check-in; about R3,000 a month.

---

## 0. Production-readiness decision (summary)

**Decision: NOT READY for 10,000 students. No-go until the P0 items in §9 are done and the §8 load tests pass on staging.**

Three of the blockers are certain, not speculative:

1. **Students cannot confirm their email on the current setup.** Email confirmation is required (`supabase/config.toml`:
   `enable_confirmations = true`, and `link_my_accounts()` refuses unconfirmed emails). Supabase's default SMTP **only delivers
   to members of the project's team** and has a small hourly cap. With a custom SMTP server the default cap is 30 messages an
   hour until you raise it. A burst of 1,000 registrations in 5 minutes cannot complete. (VERIFIED, Supabase docs)
2. **Each check-in scans the institution's last 30 days of attendance.** The device-reuse query in `check_in()` filters on
   `(institution_id, device_hash, created_at)`, and no index covers `device_hash` at institution level. Every check-in reads
   every record the institution created in 30 days. At 10k students that is hundreds of thousands of rows per check-in, and
   at 167 check-ins a second it cannot keep up. (CONFIRMED BOTTLENECK)
3. **Every Supabase Auth call comes from Vercel's servers, not from students' phones.** Sign-in, sign-up, token refresh and
   `getUser` all run in Vercel middleware or server actions. Supabase limits `/auth/v1/token` (sign-in and refresh) to 1,800
   requests an hour per IP, with bursts of 30. If Supabase attributes these calls to Vercel's egress IPs, 10k users share a
   handful of buckets. (Limit VERIFIED from docs; the IP attribution is an ASSUMPTION and the highest-priority test.)

Pilot-scale use (one institution, a few hundred to low thousands of students) is a separate decision. It needs custom SMTP at
minimum, and is still unmeasured.

---

## 1. Architecture assessment

### 1.1 What runs where (VERIFIED)

```
Phone (SA)  ──HTTPS──▶  Vercel: Next.js 15 (App Router, RSC, Server Actions)
                         ├─ middleware (every request): auth.getUser()  ─────▶ Supabase Auth (GoTrue)
                         ├─ pages / actions: supabase-js over HTTP ─────────▶ PostgREST ─▶ Postgres 17
                         └─ (no direct Postgres driver, no service-role key)
Lecturer browser ──WebSocket──▶ Supabase Realtime (postgres_changes on attendance_records)
Supabase project rbnnbmduwrvokhbkezyh: region eu-west-1 (Ireland), Postgres 17, ACTIVE_HEALTHY
Vercel project "attend": Next.js, Node 26.x, production domains *.vercel.app only, Vercel SSO protection "all_except_custom_domains"
```

- **Business logic lives in the database.** The verdict, scoring, QR signing, absence marking, imports and reports are all
  `SECURITY DEFINER` PL/pgSQL with `search_path=''`. The client sends raw evidence only. This design is good, and the
  test suite exercises it.
- **The app opens no Postgres connections.** `package.json` has no `pg`/`postgres` driver; every query goes through
  PostgREST over HTTP. Serverless fan-out therefore cannot exhaust Postgres connections. Concurrency is bounded instead
  by **PostgREST's internal pool**, which Supabase sizes per compute tier. (VERIFIED that there is no driver; the pool size per
  tier is an ASSUMPTION to read from the dashboard.)
- **Multi-tenancy uses a shared schema with RLS.** `institution_id` is on every tenant row, and composite foreign keys
  `(institution_id, id)` stop a row from pointing at another tenant's parent. (VERIFIED, and tested: "a row in A cannot
  reference B's parent even with a forged id".)
- **The project is shared with another app.** The `uniattend` schema sits beside `public` (acvosa) in one Supabase project,
  so `auth.users` is shared between the two apps (see S-1).

### 1.2 Request cost of the hot paths (VERIFIED by reading code, latency unmeasured)

| Path | Auth calls | DB round-trips (sequential "waves") | Notes |
|---|---|---|---|
| Student check-in (server action `checkIn`) | 1 `getUser` (middleware) | `check_in` RPC, then `venueFor` select → 2 waves | Also `revalidatePath('/student')`. The RPC performs about 12 index lookups and **5–6 inserts** (record, 2–3 evidence rows, verification event, notification). |
| Student home `/student` | 2 `getUser` (middleware + `getSession`) | `my_roles`, then layout `shellData` (2), page (4 parallel), then `myTimetable` (2 sequential), then `loadTheme` → about 6 waves | `loadTheme` runs twice (layout and page). |
| Lecturer live register `/lecturer/sessions/[id]` | 2 `getUser` | `my_roles`, session, roster + records, late evidence, shell → about 5 waves | Re-rendered on **every** Realtime event (debounced to 800 ms) **and** every 15 s (see B-5). |
| Live QR panel | 1 `getUser` | `session_qr_token` every 20 s per open session | Cheap. |

**Latency.** Supabase is in eu-west-1. If the Vercel functions run in Vercel's default region (iad1, Washington DC), each wave
costs about 70–90 ms of transatlantic round trip. A 6-wave student home page would then spend about 0.5 s on network latency
alone. Phones in South Africa add about 150–200 ms to Europe. The function region was **not returned** by the Vercel API, so it
is **unverified** (ASSUMPTION; see §6).

### 1.3 Strengths worth keeping (VERIFIED)

- Status is computed only on the server; students cannot write attendance (tested).
- The `unique (session_id, student_id)` constraint makes a second attendance record impossible (tested: "a second check-in is
  a duplicate and creates no second record").
- QR tokens are HMAC-SHA256 over `session:step` with a per-session 32-byte secret that no client can read, so a token lives
  20–40 s (tested: forged or stale tokens are rejected; students cannot read the secret or mint tokens).
- Every `UPDATE`/`DELETE` in the migrations has a `WHERE` clause, so pg_safeupdate is respected (a test checks this).
- Plan limits are enforced by a statement-level trigger, so a 5,000-row import costs one count.
- GPS coordinates are not stored; only distance, accuracy and p(inside) are kept.

---

## 2. Security assessment

| # | Severity | Finding | Status |
|---|---|---|---|
| S-1 | **High** | **Any signed-in user can become an institution admin of a new, pending institution and act on users outside it.** `request_institution()` lets any authenticated user create an institution and grants them `institution_admin` at once. `is_inst_admin()` does not check `institutions.status`, so a *pending* admin can already call `grant_role(inst, email, 'student')`. That function (a) answers "No account uses that email yet" or succeeds, which turns it into an **account-existence oracle over all of `auth.users`**, including users of the other app sharing the project; and (b) attaches a role to an arbitrary user without their consent. After that, `profiles_select` lets the attacker **read the victim's `full_name`, `email` and `phone`**. | VERIFIED by reading `0004`/`0005`; not exploited. Add a DB test. |
| S-2 | **High (availability)** | **No application rate limiting, and Auth's per-IP buckets are shared by everyone.** `signUp`, `signIn` and `requestReset` are server actions with no throttle or CAPTCHA. Supabase's limit on *emails sent* is a project-wide sum, and `/auth/v1/token` is limited per IP. If those IPs are Vercel's, one script can (a) use up the hourly email quota so that genuine students cannot register or reset passwords, and (b) drain the shared sign-in bucket. | Limits VERIFIED (docs); the IP attribution is an ASSUMPTION, see T-AUTH. |
| S-3 | Medium (POPIA) | **Retention is promised but not implemented.** `institution_settings.retention_days` exists and the privacy notice says records are "then deleted", but no job deletes anything (no pg_cron, no Edge Function). `notifications`, `attendance_verification_events`, `attendance_evidence` and `audit_logs` grow without limit. | VERIFIED (grep). |
| S-4 | Medium (POPIA) | **Over-broad reads.** `profiles_select` gives an institution admin every profile of anyone holding *any* role there, including `phone`, which the app never needs for an admin. `lecturers_select` lets **every student** read every lecturer's `email`, `staff_number` and `department` across the institution. | VERIFIED. |
| S-5 | Medium | **Typed join code plus spoofed GPS reaches "accepted".** The 6-character join code is static for the whole session and shown on screen. Code (15) + GPS (40) + device (20) = 75, which is at least `accept_score` 70. A code relayed by message to someone with a spoofing app that varies its accuracy is accepted. Without GPS the result is "review" (tested). This is a design trade-off, not a bug. | VERIFIED by arithmetic. |
| S-6 | Low | **Some helper functions callable as RPC leak small facts across tenants.** `module_of_record(uuid)`, `plan_feature(uuid,text)` and `institution_can_operate(uuid)` are `SECURITY DEFINER`, granted to `authenticated` and callable directly. Given a UUID, they reveal a record's module, a plan feature, or whether an institution is active. | VERIFIED. |
| S-7 | Low | **The device hash is not salted per institution** (`SHA-256("uniattend-device:"+id)`). The earlier audit said it would be salted, so the same phone is linkable across institutions. | VERIFIED. |
| S-8 | Low | **No Content-Security-Policy header** (other headers are good: HSTS, nosniff, frame DENY, a Permissions-Policy limited to self). | VERIFIED. |
| S-9 | Info | **Vercel deployment protection** is "all_except_custom_domains", and production currently has only `*.vercel.app` domains. Confirm students can reach production without a Vercel login before launch, and plan a custom domain. | VERIFIED (Vercel API); effect not tested. |

**Institution isolation.** The isolation work is good:

- RLS is enabled on every table; 0004 loops over all tables, and 0009 enables it on `institution_directory`.
- Policies key on `is_member`/`is_inst_admin` of the row's `institution_id`, and composite foreign keys add a second barrier.
- Existing tests cover admin A against B for reads and writes, student A against B, lecturer A against B's module, and student B
  with A's live token.

S-1 is the gap: it works through `auth.users` and `profiles`, not through tenant tables.

**Recommendations (security):**

- Require `institutions.status = 'active'` (or super-admin approval) in `is_inst_admin` for `grant_role` and `import_students`.
- Make `grant_role` return the same message whether or not the account exists, and turn it into an invitation the user must accept.
- Drop `phone` from admin-visible profile reads, using a column-limited view or RPC.
- Restrict `lecturers_select` for students to lecturers of their own modules, and to name only.
- Add Turnstile or hCaptcha to signup and reset (Supabase Auth supports both natively).
- Add Vercel WAF rate-limit rules (see §6).
- Implement retention (see §9).
- Revoke `EXECUTE` from `authenticated` on `module_of_record`, `plan_feature` and `institution_can_operate`. RLS policies can still
  call them, because policy evaluation uses the function owner only for `SECURITY DEFINER`; verify this in a test first.
- Salt the device hash per institution.
- Add a CSP.

---

## 3. Database performance assessment

### 3.1 `check_in()` — concurrency, races, duplicates

| # | Finding | Severity | Status |
|---|---|---|---|
| D-1 | **The device-reuse query is not indexed for its predicate.** `select count(distinct student_id) from attendance_records where institution_id = $1 and device_hash = $2 and student_id <> $3 and created_at > now() - 30 days`. The best available index is `attendance_records_inst_created (institution_id, created_at desc)`, so every check-in reads **all of the institution's records from the last 30 days**. Absence rows are included, because `close_session` inserts one per absent student. Rough size: 10k students × ~10 classes a week × ~4.3 weeks ≈ **400k rows per check-in**. | **Critical** | CONFIRMED BOTTLENECK. Confirm with `EXPLAIN (ANALYZE, BUFFERS)` on seeded staging. |
| D-2 | **Concurrent duplicates.** Two simultaneous submissions from the same student can both pass the "existing?" read. The second `INSERT … ON CONFLICT DO UPDATE … WHERE ar.status='pending_verification'` updates nothing. It then re-reads the row and still logs an **'accepted' verification event, inserts evidence rows and sends a second notification**, and returns `outcome: accepted`. No second attendance record is created; the side tables are duplicated. | Medium | VERIFIED by reading. Measured by `loadtest/sql/validate-checkins.sql`. |
| D-3 | **The rate limit is count-then-insert and not atomic.** A burst of parallel requests from one student can exceed 5 a minute. | Low | VERIFIED by reading. |
| D-4 | **`check_in` races `close_session`.** `check_in` reads the session with no lock. If `close_session` commits between that read and the insert, two outcomes are possible: (a) the absence row wins the conflict and the student is told **"accepted" while the record says 'absent'**; or (b) close's `UPDATE … WHERE status='late_pending'` runs before the check-in's uncommitted `late_pending` row is visible, which leaves a **`late_pending` row in a closed session that nothing ever resolves**. | Medium | VERIFIED by reading (0010 as uncommitted). |
| D-5 | **Write amplification.** Each accepted check-in performs about 6 inserts across 4 tables (about 12 index updates) and feeds Realtime's WAL decoding. 10,000 check-ins a minute therefore means about 1,000 inserts a second. | Info | Estimate. |
| D-6 | **No hot-row contention.** Check-ins do not update `class_sessions`, so even 500 students checking into one session do not queue on a row lock. This is good. | Positive | VERIFIED. |

### 3.2 RLS cost

- **D-7 (High). Policies call `SECURITY DEFINER` functions with a per-row argument.** Examples are `is_inst_admin(institution_id)`,
  `teaches_module(module_id)` and `lecturer_sees_student(id)`. Postgres cannot inline definer functions or cache them as an
  initPlan when the argument is a column, so each candidate row costs 1–4 extra sub-queries.
  - The lecturer roster query (`module_enrolments → students`) evaluates `teaches_module` per enrolment.
  - It then evaluates `is_inst_admin` + `lecturer_sees_student` per student and `teaches_module` per attendance record. That is
    about 1,500–2,000 function calls per render for a 500-student module.
  - VERIFIED design; cost unmeasured.
  - RECOMMENDATION: use the "set" form, for example `institution_id in (select uniattend.my_admin_institutions())` and
    `module_id in (select uniattend.my_taught_modules())`. These run once per statement.
- **D-8 (High). Student pages filter only by `institution_id`.** `/student` ("recent", `limit 5`) and `/student/history`
  (`limit 200`) select `attendance_records … eq('institution_id') order by created_at desc`. The planner walks
  `attendance_records_inst_created` over **the whole institution's history** and applies the per-row RLS predicates until it
  finds 5 (or 200) rows the student can see. For a student whose last record is a week old, that is tens of thousands of rows
  times 3–4 function calls, on the most-visited page. CONFIRMED BOTTLENECK.
  - Fix: add `.eq('student_id', <own student id>)`, which hits `attendance_records_student`.
  - `attendance_disputes` on `/student/history` has the same shape but a much smaller table.
- **D-9 (Medium). The lecturer "awaiting review" list is not indexed for its filter.** `/lecturer/disputes` filters
  `institution_id + status='pending_verification'`, and no index has `(institution_id, status)`, so it scans the institution's
  records with per-row RLS. `institution_overview()` counts pending records the same way.

### 3.3 Dashboards and reports (Medium)

- `institution_dashboard()` aggregates 30 days of records **and** 30 days of verification events, reading `layers->'gps'` from
  jsonb per row, on every admin page view. There is no caching. At about 1M events a month this is a heavy query run on demand.
- `institution_overview()` (`/admin`) scans the institution's records for `low_modules`, and that scan has **no date bound**
  (all-time per module).
- `module_report()` is well indexed via enrolments and sessions, and fine at about 500 students.
- RECOMMENDATION: pre-aggregate into a `daily_attendance_rollup` table, updated by `close_session` or by pg_cron every 5 minutes,
  and serve dashboards from it.

### 3.4 Indexes, constraints, growth

- **Missing indexes (RECOMMENDATION):**
  - `attendance_records (institution_id, device_hash, created_at) where device_hash is not null` (fixes D-1);
  - `attendance_records (institution_id, status) where status in ('pending_verification','late_pending','disputed')`;
  - `attendance_verification_events (session_id)` for cascades;
  - `class_sessions (lecturer_id)` and `(venue_id)`, used by admin delete checks;
  - `students (lower(email))`, `students (lower(student_number))` and `lecturers (lower(email))` without `institution_id`, for
    `link_my_accounts()` (see D-10).
- **D-10 (Medium). `link_my_accounts()` runs on every sign-in, every email-confirmation callback, and on `/dashboard` when the
  user has no roles.** Its `UPDATE … where lower(s.email)=em or lower(s.student_number)=localpart` has no usable index across
  institutions, so it is a sequential scan of `students` and of `lecturers`. That is cheap at 10k rows, but it is multiplied by
  registration bursts and the table keeps growing.
- **Constraints are good.** The unique constraints that prevent duplicates (`(session_id, student_id)`, one open dispute per
  record, one live subscription, a unique open join code per institution) are in place. The 0010 status `CHECK` is replaced
  cleanly.
- **D-11 (Medium). Growth.** Each class creates per student about 1 record + 1–3 evidence rows + 1–2 events + 2 notifications
  (one at session open, one at check-in). At 10k students and about 10 classes a week that is about 0.6–0.9M rows a week, or
  **about 30–45M rows a year**, with nothing purging them. RECOMMENDATION: add retention (S-3). Consider monthly partitioning of
  `attendance_verification_events` and `notifications`.
- **D-12 (Medium, correctness at scale). PostgREST's default `max_rows` (1,000 on Supabase) silently truncates list queries.**
  - `/admin/modules` loads **all active enrolments of the institution** (`module_enrolments … eq institution_id`) to count
    students per module. At 10k students × ~6 modules, about 60k rows are needed and only 1,000 are returned, so the counts are wrong.
  - The lecturer home caps records at 5,000, and its rates are silently computed on partial data once that cap is hit.
  - RECOMMENDATION: compute these counts in SQL.
- **The new `late_pending` status is not counted** in `institution_dashboard` "today" or in `institution_overview` pending
  (Low; these are open-session states).

### 3.5 Connections and Realtime

- **The app holds no Postgres connections.** PostgREST's pool and Realtime's own connections are the limits. Read the pool size
  for the chosen tier in Dashboard → Database → Settings, and watch "Pool waiting" during the tests. (ASSUMPTION)
- **D-13 (Medium). The `supabase_realtime` publication carries `attendance_records`, `class_sessions` and `notifications`.**
  Only `attendance_records` has a subscriber (`RealtimeRefresh`). Every insert into the other two, about 2 notifications per
  check-in, is still decoded and processed by Realtime. Postgres Changes are processed in order and checked against RLS per
  subscriber; Supabase's own guidance is that Postgres Changes scale worse than Broadcast. (ASSUMPTION on throughput)
  - RECOMMENDATION: remove `notifications` and `class_sessions` from the publication.
  - Better: publish a compact "session counts changed" Broadcast from a trigger (`realtime.broadcast_changes` or `realtime.send`).

---

## 4. Bottleneck inventory (ranked by severity)

| Rank | ID | Bottleneck | Severity | Kind | Affects target |
|---|---|---|---|---|---|
| 1 | B-1 | **Email confirmation cannot be delivered.** The default SMTP only delivers to team addresses and has a small cap; custom SMTP defaults to 30 an hour. | Critical | CONFIRMED (docs + config) | 1,000 registrations / 5 min |
| 2 | B-2 | **The `check_in` device query scans 30 days of institution records** (D-1). | Critical | CONFIRMED | 5k–10k check-ins/min, p95 < 1 s |
| 3 | B-3 | **Auth calls originate from Vercel.** Two `getUser` round trips per page view, and `/auth/v1/token` (sign-in and refresh) limited to 1,800/h per IP with a burst of 30, possibly shared by every user. | Critical (if attribution is per Vercel IP), else High | Limits VERIFIED; attribution ASSUMPTION | Everything |
| 4 | B-4 | **Student home and history scan the institution's history under RLS** (D-8). | High | CONFIRMED | 10k concurrent, p95 < 500 ms |
| 5 | B-5 | **Live register refresh storm.** Every attendance insert triggers `router.refresh()` (after 800 ms) of a full server render with per-row RLS (D-7), plus an **unconditional 15 s poll**. 20 concurrent 500-student sessions in a 60 s burst ≈ 20 × 75 renders/min ≈ 1,500 heavy renders/min, about 2M definer calls/min. | High | VERIFIED design; cost ASSUMPTION | Check-in p95 under burst |
| 6 | B-6 | **No app or edge rate limiting** (S-2). One abuser can exhaust project-wide email quotas and shared IP buckets. | High | VERIFIED | Registration availability |
| 7 | B-7 | **The Vercel function region is probably far from the database** (iad1 default vs eu-west-1). | High | ASSUMPTION (region not returned by API) | p95 < 500 ms |
| 8 | B-8 | **Per-row definer predicates in RLS** (D-7) on every list query. | High | VERIFIED design | p95 < 500 ms |
| 9 | B-9 | **Realtime publication includes unsubscribed, high-volume tables** (D-13). | Medium | ASSUMPTION on impact | Check-in burst |
| 10 | B-10 | **On-demand 30-day dashboard aggregations** (§3.3). | Medium | VERIFIED design | Admin p95 |
| 11 | B-11 | **`check_in` races:** duplicate side effects (D-2), non-atomic rate limit (D-3), close race (D-4). | Medium | VERIFIED by reading | Correctness, duplicate metric |
| 12 | B-12 | **PostgREST 1,000-row cap truncates admin counts** (D-12). | Medium | VERIFIED | Correctness |
| 13 | B-13 | **Backups, PITR and monitoring not verified.** The plan and compute tier were not visible to me. No log drain, error tracker or alerting is configured in the repo. | Medium | Not verifiable here | Recovery, operations |
| 14 | B-14 | **Unbounded growth, no retention** (D-11, S-3). | Medium | VERIFIED | Cost, POPIA, query time |
| 15 | B-15 | **`link_my_accounts` sequential scans on each login** (D-10). | Low–Medium | VERIFIED | Registration and login bursts |

---

## 5. Recommended Supabase compute

**Starting point: Pro plan + Large compute** (2 dedicated ARM vCPU, 8 GB RAM, per Supabase's compute table), **for the
staging load test**. Treat it as a hypothesis, not a sizing result.

Reasoning (estimates, not measurements):

- At the 10k/min check-in target, `check_in` runs about 167 times a second, with about 1,000 inserts a second plus about 2,000
  index lookups a second. With D-1 fixed, each call should be a few milliseconds of CPU (ASSUMPTION), which is within 2 vCPU
  with headroom.
- **With D-1 not fixed, no tier is sufficient.** Its cost grows with history, not with compute.
- The concurrent read load (10k users on student and lecturer pages) is dominated by B-4, B-5 and B-8. Fixing those is cheaper
  than buying XL.

Decision rule for the staging run (record the results in §8):

- **Stay on Large** if, during the `burst10k` check-in scenario, all of the following hold:
  - DB CPU stays under 70% sustained;
  - there is no "pool waiting" in PostgREST;
  - the disk IO budget is not depleted;
  - check-in p95 is under 1 s.
- **Move to XL** (4 vCPU / 16 GB) only if CPU-bound **after** the P0/P1 fixes. XL costs about $100 more a month (§7), which
  breaks the R3,000 budget.
- Check the **IO budget**: smaller tiers have burst IO credits that a 60 s burst can drain.

Other Supabase settings (RECOMMENDATION):

- Custom SMTP (SES, Postmark, Resend) with the auth email rate limit raised to at least 1,000 an hour (12,000 an hour if 1,000
  registrations in 5 min must all receive mail at once).
- CAPTCHA on signup and reset.
- Asymmetric JWT signing keys, so the app can verify sessions locally with `getClaims()` instead of calling `getUser()`.
- Raise per-IP Auth limits **only after** T-AUTH shows how IPs are attributed.
- A **staging project** (or a Supabase branch) seeded with `loadtest/seed/seed-staging.sql`. Never load-test the production ref.
- Before a large planned event, Supabase asks for 2 weeks' notice through support for Team or Enterprise plans.

---

## 6. Recommended Vercel configuration

All RECOMMENDATIONS; nothing has been changed.

| Setting | Recommendation | Why |
|---|---|---|
| Plan | **Pro** (Hobby is non-commercial and has lower limits) | Commercial SaaS |
| Function region | **`dub1` (Dublin)**, matching Supabase eu-west-1. Set it in Project → Settings → Functions, or in `vercel.json` with `"regions": ["dub1"]`. | Removes about 70–90 ms per DB round trip (B-7). First **verify** the current region in the dashboard. |
| Fluid compute | On (the default for new projects) | Concurrent requests share warm instances, so there are fewer cold starts in bursts |
| `maxDuration` | Leave the default for pages and actions; keep `60` only on `/admin/timetable` (already set) | Fail fast under overload |
| Middleware | Replace `auth.getUser()` with `auth.getClaims()` (local JWT verification) once asymmetric keys are on, and narrow the matcher to authenticated areas | Removes one Auth round trip per request (B-3) |
| WAF rate limits | Per client IP: `POST /signup`, `/login`, `/forgot-password`: 10/min; `POST /student/check-in` (server action): 30/min; everything else: 300/min | B-6. These run at Vercel's edge, which sees the real client IP. |
| Attack Challenge Mode | Keep it available; **disable for the load generator** with a staging bypass rule | Otherwise k6 will be challenged |
| Deployment protection | Staging: protected, with an **Automation Bypass** secret (`VERCEL_BYPASS` in the k6 scripts). Production: confirm students can reach it; add a custom domain. | S-9 |
| Spend management | Set a hard monthly cap, for example $80 on-demand | Keeps the budget safe |
| Observability | Enable a log drain or Observability Plus only if within budget; at minimum, Sentry (free tier) for server errors | B-13 |
| Live register | Remove the unconditional 15 s poll when the Realtime channel is `SUBSCRIBED`; refresh at most every 3–5 s | B-5 (app change) |

---

## 7. Monthly cost estimate (USD and ZAR at R16.53/USD)

These are **estimates from public list prices as I know them**; verify each line on the vendors' pricing pages before
budgeting. Usage lines are guesses from the traffic model (10k students, about 300 page views per student per month).

| Line | Budget option (A) | Recommended prod (B) | If XL needed (C) |
|---|---|---|---|
| Supabase Pro base | $25 | $25 | $25 |
| Compute (Large $110 / XL $210) minus the $10 Pro compute credit | $100 | $100 | $200 |
| PITR, 7 days | — | $100 | $100 |
| Supabase usage overage (egress over 250 GB, disk over 8 GB, Realtime over 500 connections and 5M messages) | $0–10 | $0–10 | $0–10 |
| Vercel Pro, 1 seat (includes $20 usage credit) | $20 | $20 | $20 |
| Vercel usage over the credit (edge requests, function CPU and memory, invocations) | $0–60 | $0–60 | $0–60 |
| Transactional email (Amazon SES at about $0.10 per 1k; Resend or Postmark about $15–20) | $1–20 | $1–20 | $1–20 |
| Error tracking and uptime (Sentry Developer and Better Stack free tiers) | $0 | $0–26 | $0–26 |
| **Total USD** | **$146–235** | **$246–361** | **$346–461** |
| **Total ZAR** | **R2,413–3,885** | **R4,066–5,967** | **R5,719–7,620** |

Reading the table:

- **Option A can fit R3,000 only at the low end of usage, and only without PITR.** In that case the recovery point is Pro's
  daily backups (up to 24 h of data loss).
- **Option B is my recommendation for production attendance records.** Losing a day of a university's attendance register is a
  serious incident. It is about R1,000–3,000 over the stated budget.
- Option C applies only if the staging test proves Large insufficient *after* the fixes.

---

## 8. Load tests

Scripts are in `loadtest/` (see `loadtest/README.md`). They take the staging URL and keys from environment variables and
**refuse to run** against the production Supabase ref (`rbnnbmduwrvokhbkezyh`) or the production Vercel domains. They also
require `LOADTEST_CONFIRM=staging`.

| Test | Script | Scenarios | What it measures |
|---|---|---|---|
| T-REG registration | `loadtest/registration.js` | `ramp` (100 → 500 → 1k → 5k → 10k VUs), `burst1k` (1,000 sign-ups in 5 min) | RPS, p50/p95/p99, error rate, 429 rate, whether emails are accepted |
| T-CHK check-in (DB path) | `loadtest/checkin.js` with `TARGET=rest` | `ramp`, `burst5k` (5,000 in 60 s), `burst10k` (10,000 in 60 s) | RPS, p50/p95/p99, error rate, outcomes, client-side and DB-side duplicates |
| T-CHK-E2E check-in through Next.js | `loadtest/checkin.js` with `TARGET=app` | same | Adds Vercel, middleware, `getUser` and the server action. Needs the action id from the staging build. |
| T-AUTH Auth IP attribution | `loadtest/registration.js` with `SCENARIO=auth_ip` | 60 sign-ins in 30 s from one generator, direct vs through the app | Whether 429s appear after about 30, which tells whether the per-IP bucket is the generator's or Vercel's |
| DB validation | `loadtest/sql/validate-checkins.sql` | after each run | Duplicate records (must be 0), duplicate accepted events and notifications (D-2), late_pending rows in closed sessions (D-4) |

**What was checked here.**

- The seed, reset, validation and cleanup SQL ran against the real migrations on PGlite with a scaled-down seed (60 students,
  3 sessions). The seed is idempotent and the guard fires without the setting.
- The QR token computed as in `loadtest/lib/identity.js` matches `uniattend.qr_sign()`. Seeded check-ins came back as
  accepted / present / 100, then duplicate, and a forged token was rejected.
- Cleanup leaves no rows.
- The k6 JavaScript was syntax-checked only; k6 was not installed in the audit environment.

**Results (all PENDING; nothing has been run):**

| Test | Scenario | RPS | p50 | p95 | p99 | Error rate | Duplicates (DB) | Pass/fail vs target |
|---|---|---|---|---|---|---|---|---|
| T-REG | ramp | PENDING | PENDING | PENDING | PENDING | PENDING | n/a | PENDING |
| T-REG | burst1k | PENDING | PENDING | PENDING | PENDING | PENDING | n/a | PENDING |
| T-AUTH | auth_ip | PENDING | — | — | — | PENDING (429 count) | n/a | PENDING |
| T-CHK (rest) | ramp | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |
| T-CHK (rest) | burst5k | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |
| T-CHK (rest) | burst10k | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |
| T-CHK-E2E | burst5k | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |
| T-CHK-E2E | burst10k | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |

Also record DB CPU, memory, IO budget, PostgREST pool waiting, Realtime message lag, and Vercel function p95 and concurrency for
each run.

**Run order:**

1. T-AUTH, which decides B-3.
2. T-CHK `burst5k` on unmodified staging, as a baseline to confirm D-1.
3. Apply the P0 fixes to staging and rerun.
4. `ramp`.
5. `burst10k`.
6. E2E.
7. T-REG with a mail sink (Mailpit/Mailtrap) as SMTP so no real emails are sent.

---

## 9. Remediation plan

Owners and dates are for the product owner to assign. Every item is a RECOMMENDATION; this audit changed nothing.

**P0: before any 10k load test or launch**

1. **Email:** custom SMTP on production *and* staging (a sink on staging); raise the auth email rate limit; add CAPTCHA on
   signup and reset. (B-1, B-6)
2. **Migration 0011 (indexes):**
   - `attendance_records(institution_id, device_hash, created_at) where device_hash is not null` (B-2);
   - `attendance_records(institution_id, status)` partial on the unresolved statuses (D-9);
   - `attendance_verification_events(session_id)`;
   - `class_sessions(lecturer_id)` and `class_sessions(venue_id)`;
   - `lower(email)` and `lower(student_number)` indexes for `link_my_accounts`.

   Build them with `CREATE INDEX CONCURRENTLY`, which cannot run inside a transaction, so apply them outside the migration
   transaction on large tables.
3. **Student queries:** filter `/student` "recent" and `/student/history` by the student's own `student_id` (B-4).
4. **Auth path:**
   - Run T-AUTH.
   - Enable asymmetric JWT keys and switch middleware and `getSession` to `getClaims()`.
   - Call `getUser()` only where the full user is needed.
   - If T-AUTH shows Vercel-IP attribution, move sign-in to the browser client (`supabase.auth.signInWithPassword` from the
     phone, so Auth sees the student's IP) and keep cookie sync through `@supabase/ssr`. (B-3)
5. **Vercel:** verify the function region and set `dub1`; add the WAF rules; set up deployment-protection bypass for staging.
   (B-6, B-7)
6. **Fix S-1:** require an active institution for `grant_role` and imports, and make `grant_role` non-enumerating.
7. **Staging:** set up a separate Supabase project or branch and a Vercel preview; seed it; run §8.

**P1: before or at launch**

8. Rewrite the RLS predicates in set form (`… in (select uniattend.my_*())`) and add tests for equivalence. (B-8)
9. Live register:
   - Drop the unconditional 15 s poll while the channel is `SUBSCRIBED`.
   - Throttle refreshes to at most every 3–5 s.
   - Better: make the register client-side and update it from a Broadcast payload instead of a full RSC re-render. (B-5)
10. Remove `notifications` and `class_sessions` from `supabase_realtime`. (B-9)
11. `check_in` hardening:
    - Re-check `status='open'` in the same statement as the insert, or take `FOR SHARE` on the session row. Measure MultiXact
      contention under `burst10k` before choosing `FOR SHARE`.
    - Make `close_session` resolve any `late_pending` rows that appear after it, or block new check-ins first.
    - Write the verification event as 'duplicate' when the upsert did not apply.
    - Use an advisory lock (`pg_advisory_xact_lock(hashtext(student||session))`) to make the rate limit atomic. (B-11)
12. Dashboards from a rollup table; compute admin and lecturer counts in SQL, not by fetching rows. (B-10, B-12)
13. POPIA tightening: S-4 (phone, lecturer emails), S-6, S-7.

**P2: within the first term**

14. Retention: a pg_cron job honouring `retention_days` for records, evidence and events; a 90-day cap on notifications; an
    audit-log policy. Fix the privacy notice if any data is kept longer. (S-3, B-14)
15. Backups: turn on PITR (option B in §7); **run a restore drill** to a scratch project and document the RPO and RTO.
16. Monitoring and alerts:
    - Supabase: CPU over 70%, disk over 80%, connections; Auth 429s in logs.
    - Sentry for Next.js.
    - An uptime check on `/login` and on a lightweight health route.
    - A weekly `pg_stat_statements` review. (B-13)
17. Partition `attendance_verification_events` and `notifications` by month if growth follows D-11.

---

## 10. Production-readiness decision

| Area | Verdict |
|---|---|
| Security model and tenant isolation | **Good foundations, one High (S-1) to fix** before more institutions onboard |
| Registration at the target burst | **Blocked** (B-1); unmeasured after the fix |
| Check-in at 5k–10k/min | **Blocked** (B-2); unmeasured after the fix |
| Page latency at 10k concurrent | **At risk** (B-3, B-4, B-7, B-8); unmeasured |
| Backups and monitoring | **Not verified** (B-13) |
| POPIA | **Gaps** (S-3 retention, S-4 over-broad reads) |
| Budget R3,000/month | **Only without PITR and at low usage**; recommended production is about R4,000–6,000 |

**Decision: NO-GO for 10,000 students today.** The path to a go decision:

1. Complete P0 items 1–7.
2. Run §8 on staging at Pro + Large.
3. Record the results in §8, and decide the compute tier with the §5 rule.
4. Make the go/no-go decision **on the measured p95 and error rates** against the targets: API p95 < 500 ms, check-in p95 < 1 s,
   error rate < 1%, and 0 duplicate attendance records.

Until then, this report claims no capacity.
