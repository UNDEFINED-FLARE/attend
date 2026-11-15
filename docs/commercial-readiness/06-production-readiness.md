# 06 — Production readiness

*15 November 2026, `main` at migration 0033. Status words as in [01-technical-audit.md](01-technical-audit.md).*

**Decision: ready for a controlled pilot with one department once the P0 items in §6 are done. Not ready for a full university or a paid contract.** The application is in good shape; the infrastructure around it is not yet production-grade.

## 1. Current infrastructure (checked)

| Part | Now | Production need |
|---|---|---|
| Database | Supabase project `uniattend`, `eu-west-1`, Postgres 17, **free plan**, **shared with three other apps** | Dedicated project, paid plan (Pro or above), same or South African region |
| Staging | **None** | A second project and a Vercel preview environment |
| Backups | **None on the free plan**; no restore has ever been tried | Daily backups; point-in-time recovery; a tested restore |
| App hosting | Vercel (`attend-seven-liart.vercel.app`, `attend-blueflare.vercel.app`) | Custom domain; production and preview separated |
| Email | Supabase default mailer (delivers only to the project's own team, small hourly cap) | Custom SMTP on the UniAttend domain |
| Bot protection | Cloudflare Turnstile wired; off until keys are set | Keys set in Supabase Auth and Vercel |
| Leaked-password check | Off | On |
| Background jobs | `pg_cron`: push (every minute), retention (00:30), classes (23:00); all succeeding | Same, monitored |
| Health | `/api/health`: database, migrations behind the build, failed or late jobs (0028) | An uptime monitor calling it every 5 minutes |
| Error alerts | `src/instrumentation.ts` posts server errors to `ALERT_WEBHOOK_URL` if it is set | Set it (Slack/Teams/email webhook); add an error tracker if volume grows |
| Secrets | Dispatch secret reuses a Supabase secret key (S3 in [03-security-review.md](03-security-review.md)) | Separate random secret; key rotated |

## 2. Environment variables (names only)

| Name | Where | Purpose | Required |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel | Database and auth (public key only; the service-role key is never used by the app) | Yes |
| `NEXT_PUBLIC_SITE_URL` | Vercel | Links in emails and redirects | Yes |
| `INTEGRATION_ENCRYPTION_KEY` | Vercel | AES-256-GCM key for stored integration credentials (32 bytes, base64) | Yes, for integrations |
| `PUSH_DISPATCH_SECRET` | Vercel (and its SHA-256 in `push_config`) | Lets `pg_cron` hand work to the app | Yes |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Vercel | Web push | For notifications |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Vercel (secret in Supabase Auth) | Bot check at sign-in | Recommended |
| `ORS_API_KEY` | Vercel | Walking directions | Optional |
| `ALERT_WEBHOOK_URL` | Vercel | Server-error alerts | Recommended |

`.env.local` and `supabase/push-schedule.sql` hold real values locally and are never committed.

## 3. Recovery targets (proposed)

| | Pilot | Contract |
|---|---|---|
| Recovery point objective (data that may be lost) | 24 hours | 5 minutes (point-in-time recovery) |
| Recovery time objective (time to restore service) | 8 hours | 4 hours |
| Backup frequency | Daily (Pro plan) | Continuous WAL (PITR add-on) |
| Backup retention | 7 days | 7–28 days, matching the retention schedule |

**These are targets, not achievements.** They become true only after the restore drill in [11-deployment-runbook.md](11-deployment-runbook.md) §5 has been run and timed.

## 4. Monitoring checklist

- [x] `/api/health` checks the database, the migration level and the three background jobs.
- [x] Server errors can be posted to a webhook.
- [x] Every integration run, export and decision is recorded.
- [ ] An uptime monitor on `/api/health` with alerts to a phone.
- [ ] `ALERT_WEBHOOK_URL` set.
- [ ] Supabase database CPU, connections and disk alerts configured (dashboard).
- [ ] A weekly look at the Supabase security and performance advisors.

## 5. Capacity

Nothing has been load-tested. See [07-load-test-report.md](07-load-test-report.md). The known risks for a large launch are email sending limits, Supabase Auth's per-IP limits if sign-ins all come from Vercel's servers, and the institutional report's speed on very large universities (about one second for 719 modules today).

## 6. What must happen before a pilot (P0)

| # | Item | Who |
|---|---|---|
| 1 | Dedicated Supabase project on a paid plan, data moved, old project kept as staging or retired | Owner, then development |
| 2 | Custom SMTP on the UniAttend domain | Owner |
| 3 | Rotate the Supabase secret key; new random dispatch secret | Owner |
| 4 | Turn on leaked-password protection and Turnstile | Owner |
| 5 | Uptime monitor on `/api/health`; `ALERT_WEBHOOK_URL` set | Owner |
| 6 | First backup restore drill | Owner and development |
| 7 | Signed operator agreement with the pilot university | Owner |
| 8 | Real-phone tests ([08-mobile-test-report.md](08-mobile-test-report.md)) | Development with testers |

## 7. Before a paid contract (P1)

Load tests on staging; point-in-time recovery; a custom domain; Android release build on Play internal testing; attorney review; insurance; Paystack in test mode then live, or invoicing only.
