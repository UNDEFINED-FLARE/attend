# 07 — Load test report

*15 November 2026.*

> **No load test has been run.** There is no staging environment to run them against, and they must never run against production. Every result below is **PENDING**. Nothing in this document is a claim about UniAttend's capacity.

## 1. What exists

- k6 scripts in [`loadtest/`](../../loadtest/README.md): registration (`registration.js`), check-in through the database API and end to end through the app (`checkin.js`), and an Auth IP-attribution test.
- Seed, reset, validation and clean-up SQL for a staging database (10,000 students in 20 sessions of 500 by default).
- Safety rails: each script refuses to start without `LOADTEST_CONFIRM=staging`, refuses the production Supabase reference and production Vercel hosts, and the SQL scripts refuse unless the session sets `uniattend.loadtest_target = 'staging'`.
- The seed, reset and validation SQL were exercised on PGlite with a scaled-down seed; the k6 scripts were syntax-checked only.
- The earlier capacity audit: [`docs/capacity/10k-readiness-report.md`](../capacity/10k-readiness-report.md) (9 November 2026). Its check-in bottleneck D-1 (the device-reuse query scanning 30 days of records) was fixed in migration 0010 by the index `attendance_records_device_recent`; that fix is untested under load.

## 2. Scenarios required by the brief

| # | Scenario | Script / method | Target (engineering goal, not a claim) | Result |
|---|---|---|---|---|
| L1 | Lecture start: 500 check-ins in 5–10 minutes, one session | `checkin.js` (rest and app) | ≥ 99% success; p95 < 1 s | PENDING |
| L2 | 2,000 concurrent users | `checkin.js` ramp | Error rate < 1%; p95 < 1 s | PENDING |
| L3 | 10,000 registered students | seed + `registration.js` ramp | Registration p95 < 2 s; no email throttling (needs custom SMTP) | PENDING |
| L4 | 20 lectures at once (multiple sessions) | `checkin.js burst5k` / `burst10k` | No duplicates; p95 < 1 s | PENDING |
| L5 | Large lecturer register (500 students) | open the register and decide 500 reviews | Page < 2 s; `decide_review` 500 records < 3 s | PENDING — no script yet |
| L6 | Large CSV import (20,000 rows) | Import Centre preview and commit on staging | Preview < 30 s; commit < 60 s (the route limit) | PENDING — no script yet |
| L7 | Timetable sync (two weeks, whole university) | `generate_timetable_events` on a staging copy | < 30 s | PENDING — no script yet |
| L8 | Institutional report | `institution_report` for a year, all modules | < 3 s | Measured once on live data: **about 1 s for 719 modules / 14 classes** (15 Nov 2026, read-only). Not a load test. |
| L9 | Auth per-IP limits | `registration.js SCENARIO=auth_ip` | Find whether limits apply to Vercel's IPs | PENDING — decides the sign-in design |

For each run, record: request success rate, p50/p95/p99, error and 429 rates, database CPU and connections (Supabase dashboard), and the validation SQL output (accepted, duplicates, review counts).

## 3. Known risks to test first

1. **Email**: the default Supabase mailer cannot carry a registration burst. Custom SMTP is a precondition for L3.
2. **Auth per-IP limits** (L9): if every sign-in is attributed to Vercel's servers, many students share one rate-limit bucket.
3. **Reports and review queues at scale** (L5, L8): both run permission checks per module or record.

## 4. How to run (on staging only)

Follow [`loadtest/README.md`](../../loadtest/README.md): create the staging project, apply `supabase/install-uniattend.sql`, seed, run each scenario, validate, reset between runs, clean up. Write the numbers into §2 with the date, the Supabase compute size and the Vercel plan.
