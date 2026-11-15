# 11 — Deployment runbook

*15 November 2026. Step-by-step instructions for whoever deploys or operates UniAttend. Commands are run from the repository root.*

## 1. Normal change (code and database)

1. Work on a branch. Every database change is a new numbered migration `supabase/migrations/YYYYMMDD0000NN_name.sql` that ends with
   `insert into uniattend.schema_versions (version, name) values ('<prefix>', '<name>') on conflict (version) do nothing;`
2. Set `EXPECTED_SCHEMA` in `src/lib/schema-version.ts` to the new prefix.
3. Run the checks:
   ```bash
   npx tsc --noEmit
   ```
   ```bash
   npm test
   ```
   ```bash
   npm run build
   ```
   ```bash
   npx eslint src tests
   ```
4. Regenerate the bundle and the blueprint appendix:
   ```bash
   npm run bundle:sql
   ```
   ```bash
   python scripts/blueprint-appendix.py
   ```
5. **Apply the migration to staging, then production, before deploying the app** (the app expects the new schema; `/api/health` reports "degraded" until the database has it). In the Supabase SQL editor, paste the migration file and run it. A migration runs as one transaction: if any statement fails, nothing is applied.
6. Merge to `main`. Vercel deploys automatically.
7. Check `/api/health`: `"status": "ok"`, `schema.actual` equals `schema.expected`, `problems` empty.

Never commit `.env.local`, `*.local.sql` or `supabase/push-schedule.sql`.

## 2. Checking which migrations are live

```sql
select version, name, applied_at from uniattend.schema_versions order by version;
```
Before migration 0028, versions were not recorded; 0001–0027 were reconciled against the live schema on 14 November 2026 ([01-technical-audit.md](01-technical-audit.md) §2).

## 3. Rolling back

- **App:** in Vercel, promote the previous deployment. Safe whenever the database is ahead (migrations only add).
- **Database:** migrations are additive and are not reversed automatically. To undo one, write a new migration that reverses it, test it on staging, apply it. Restoring a backup is for data loss, not for a bad deploy.

## 4. Secrets

| Rotate | How |
|---|---|
| Dispatch secret | Generate (`openssl rand -hex 32`); set `PUSH_DISPATCH_SECRET` in Vercel; in SQL: `update uniattend.push_config set secret_sha256 = encode(extensions.digest('<new>', 'sha256'), 'hex'), updated_at = now() where id = 1;` and update the `pg_cron` job headers; redeploy. |
| Supabase API keys | Supabase → Settings → API keys: create a new key, update Vercel, redeploy, then revoke the old one. |
| `INTEGRATION_ENCRYPTION_KEY` | Not rotatable in place yet: stored tokens were encrypted with it. Changing it means each institution re-enters its tokens. Keep it in a password manager. |
| An institution's API key | The institution's admin: Integrations → the connection → **New key**. |

## 5. Backup restore drill (do before the pilot, then every quarter)

1. In the Supabase dashboard of the **production** project, note the latest backup time.
2. Create a new, empty project (or use staging) and restore the backup into it (Database → Backups → Restore to a new project, on paid plans).
3. Point a local copy of the app at it (`.env.local`), sign in as a test admin, open the dashboard, a report and an attendance register.
4. Run the integrity checks:
   ```sql
   select count(*) from uniattend.institutions;
   select count(*) from uniattend.attendance_records;
   select max(version) from uniattend.schema_versions;
   ```
   Compare with production.
5. Record the time from step 2 to a working app — that is the measured recovery time — and the backup age — the measured recovery point. Write both into [06-production-readiness.md](06-production-readiness.md) §3.
6. Delete the restored project.

**Not done yet: the project is on the free plan, which has no restorable backups.**

## 6. Incidents

| Symptom | First check | Then |
|---|---|---|
| `/api/health` "database not answering" | Supabase status page; project paused? | Restart the project from the dashboard; tell institutions if it lasts more than 15 minutes. |
| "migrations behind" | `schema_versions` | Apply the missing migration (§1 step 5). |
| "background job … failed or is late" | `select * from cron.job_run_details order by start_time desc limit 20;` | Fix the cause; jobs retry on their next schedule. For `uniattend-push`, check `PUSH_DISPATCH_SECRET` matches `push_config`. |
| Students can't check in | `/api/health`; the institution's subscription status; the session is open | Lecturers can mark attendance in the register; refused attempts go to review, never absent. |
| Suspected data breach | Follow [`docs/legal/breach-response-plan.md`](../legal/breach-response-plan.md): contain, assess, tell the university without undue delay. | |

## 7. Android release

See [`docs/android-app.md`](../android-app.md). A release build needs the signing key (`uniattend-release.jks`, kept outside the repository) and `android/keystore.properties`:
```bash
npm run android:release
```
Upload `android/app/build/outputs/bundle/release/app-release.aab` to Play Console internal testing first.
