# UniAttend load tests (k6) — staging only

These scripts back §8 of [docs/capacity/10k-readiness-report.md](../docs/capacity/10k-readiness-report.md).
**They have not been run yet.** Every result in that report is PENDING until someone runs them against staging.

## Safety

Each script refuses to start unless all three of these hold:

- `LOADTEST_CONFIRM=staging` is set.
- No target URL contains the production Supabase ref `rbnnbmduwrvokhbkezyh`.
- No target host is a production Vercel domain (`attend-seven-liart.vercel.app`, `attend-blueflare.vercel.app`,
  `attend-git-main-blueflare.vercel.app`). Add more with `PROD_DENYLIST=host1,host2`.

The SQL scripts refuse to run unless the session first runs `set uniattend.loadtest_target = 'staging';`. The seed also
refuses if other institutions already have students; set `uniattend.loadtest_allow_other_data = 'yes'` only on a deliberate
copy of production data.

The `TARGET=app` mode cannot see which database a Vercel deployment uses. **The staging deployment's environment variables
must point at the staging Supabase project.** If the app rejects the seeded users, the script aborts after 5 failures.

## What you need

1. **A staging Supabase project** (or a branch) with migrations 0001–0010 applied. Its Auth must use a mail sink
   (Mailpit or Mailtrap) as SMTP, so the registration test sends no real email.
2. The staging project's **legacy JWT secret** (Project Settings → API → JWT secret), passed as `STAGING_JWT_SECRET`. The
   check-in test signs its own access tokens for the seeded users, which keeps Auth's rate limits out of the database
   measurement. T-AUTH measures those limits separately.
3. For `TARGET=app`, also:
   - a Vercel staging deployment (`BASE_URL`);
   - its Automation Bypass secret (`VERCEL_BYPASS`), if deployment protection is on;
   - the build's server-action id for `checkIn`, from `.next/server/server-reference-manifest.json` in that build: the key
     whose entry lists `app/student/check-in/page`. Pass it as `NEXT_ACTION_ID_CHECKIN`.
4. [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) v0.50 or newer.
   - 10,000 VUs need several GB of RAM on one machine. Use a large VM, or split across machines with `k6 run --execution-segment`.
   - All requests from one machine share one IP, so Auth per-IP limits apply to it (see T-AUTH).

## Seeding

1. In the staging SQL editor, run `set uniattend.loadtest_target = 'staging';`.
2. Then run [seed/seed-staging.sql](seed/seed-staging.sql). Edit the parameters at its top first, and pass the same values to
   k6: `N_STUDENTS`, `N_SESSIONS`, `QR_SECRET_HEX`, `VENUE_LAT`, `VENUE_LNG`, `LOADTEST_EMAIL_DOMAIN`, `SEED_PASSWORD`.
   With the defaults it creates 10,000 students across 20 open sessions of 500 each.
3. Between runs, run [sql/reset-run.sql](sql/reset-run.sql).
4. After each run, run [sql/validate-checkins.sql](sql/validate-checkins.sql) and copy the numbers into the report.
5. When finished, run [seed/cleanup-staging.sql](seed/cleanup-staging.sql).

The seed, reset, validation and cleanup scripts were exercised against the real migrations on PGlite with a scaled-down seed
(60 students, 3 sessions). The QR token computed as in `lib/identity.js` matched `uniattend.qr_sign()`, and a seeded check-in
was accepted. The k6 scripts were syntax-checked only; k6 was not available in the audit environment.

## Common environment

```bash
export LOADTEST_CONFIRM=staging
export SUPABASE_URL=https://<staging-ref>.supabase.co
export SUPABASE_ANON_KEY=<staging anon/publishable key>
export STAGING_JWT_SECRET=<staging legacy JWT secret>
export QR_SECRET_HEX=000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
export N_STUDENTS=10000 N_SESSIONS=20 LOADTEST_EMAIL_DOMAIN=loadtest.example
```

## Check-in (T-CHK)

Database path (PostgREST RPC `check_in`):

```bash
k6 run -e TARGET=rest -e SCENARIO=burst5k loadtest/checkin.js
```

```bash
k6 run -e TARGET=rest -e SCENARIO=burst10k loadtest/checkin.js
```

```bash
k6 run -e TARGET=rest -e SCENARIO=ramp loadtest/checkin.js
```

End-to-end through Vercel and Next.js (middleware, Auth `getUser`, server action):

```bash
k6 run -e TARGET=app -e SCENARIO=burst5k -e BASE_URL=https://<staging-app> -e NEXT_ACTION_ID_CHECKIN=<id> -e VERCEL_BYPASS=<secret> loadtest/checkin.js
```

| Scenario | Shape |
|---|---|
| `ramp` | VUs step 100 → 500 → 1,000 → 5,000 → 10,000 (`RAMP_UP` 1m, `RAMP_HOLD` 2m each; `RAMP_MAX_VUS` caps it). Each VU checks in, then waits about `THINK_S` (default 5 s). Once every student has checked in, further attempts are expected duplicates. |
| `burst5k` | 5,000 check-ins started evenly over 60 s, one per student. |
| `burst10k` | 10,000 check-ins started evenly over 60 s, one per student. |

Measured:

- `http_reqs` rate (RPS);
- `http_req_duration{op:check_in}` p50, p95 and p99 (threshold: p95 < 1 s);
- `checkin_errors` rate (threshold < 1%);
- outcome counters: `checkin_accepted`, `checkin_review`, `checkin_rejected`, `checkin_duplicate`;
- `checkin_rate_limited` (the SQL 5-per-minute limit);
- `checkin_unexpected_duplicate`: requests sent twice at the same instant (`DUP_RATE`, default 2%) where both were told
  "accepted" (finding D-2, threshold 0).

Duplicates at the database are counted by `sql/validate-checkins.sql`. Duplicate attendance records must be 0; duplicate
accepted events and notifications are what D-2 predicts.

While a check-in run is going, open a few `/lecturer/sessions/<id>` pages as `loadtest+lecturer@…` to include the
Realtime-driven refresh load (finding B-5). Watch the Supabase dashboard throughout:

- CPU and IO budget;
- PostgREST pool;
- Realtime.

Watch Vercel's function metrics as well.

## Registration (T-REG) and Auth IP attribution (T-AUTH)

```bash
k6 run -e SCENARIO=burst1k -e REG_EMAIL_DOMAIN=<mail-sink domain> -e SITE_URL=https://<staging-app> loadtest/registration.js
```

```bash
k6 run -e SCENARIO=ramp -e REG_EMAIL_DOMAIN=<mail-sink domain> -e SITE_URL=https://<staging-app> loadtest/registration.js
```

```bash
k6 run -e SCENARIO=auth_ip -e SEED_PASSWORD=<seed password> loadtest/registration.js
```

| Scenario | Shape |
|---|---|
| `burst1k` | 1,000 sign-ups over 5 minutes (the registration target) |
| `ramp` | VUs step 100 → 10,000, each signing up about every `THINK_S` (default 30 s). This creates many users; clean up afterwards. |
| `auth_ip` | 60 password sign-ins of seeded users in 30 s from this one machine |

Measured:

- RPS;
- `http_req_duration{op:signup}` p50, p95 and p99 (threshold: p95 < 500 ms);
- `reg_errors`;
- `auth_429` (rate-limited);
- `reg_email_refused` (SMTP refusal or hourly cap reached);
- `reg_created`.

Sign-ups go straight to Supabase Auth with the same payload as the app's `signUp` action. The app adds one Vercel hop, which
these numbers do not include.

**Reading T-AUTH.** If 429s start after about 30 sign-ins, the per-IP `/auth/v1/token` limit applies to the generator's IP.

To learn whether the *app's* sign-ins are counted against Vercel's IPs:

1. Sign in through the staging app from two different networks.
2. In Supabase → Logs → Auth, check the IP recorded on the `/token` requests.

If the IP is a Vercel/AWS address rather than the phone's, every student shares that bucket (finding B-3), and the fix is the
P0 item 4 in the report.

## Results

`handleSummary` writes `loadtest/results/<test>-<scenario>-<timestamp>.json`; these files are git-ignored. Copy the headline
numbers into the report's §8 table, together with the DB validation output and the dashboard observations (CPU, IO budget,
pool waiting, Realtime lag).
