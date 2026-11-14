# Breach response plan (POPIA section 22)

Owner: the Information Officer. Review yearly and after every incident. Not legal advice; have an attorney confirm before launch.

## What counts

A **security compromise** is any reasonable ground to believe personal information was accessed or acquired by someone not allowed to. Examples:

- a leaked password or API key;
- a database or storage policy that let one institution see another's records;
- a lost laptop with an export on it;
- someone signing in as another person;
- a provider (Supabase, Vercel) reporting an incident affecting our project.

When unsure, treat it as one and record why you decided it wasn't.

## Roles

| Role | Who | Does |
|---|---|---|
| Incident lead | Information Officer, or deputy | Runs the response and decides on notifications |
| Technical lead | Lead developer | Contains, investigates, fixes |
| Communications | Head of company | Speaks to institutions and the Regulator |

Keep this table filled in with names and phone numbers.

## Timeline

| When | Step |
|---|---|
| **Immediately** | Contain the problem; don't destroy evidence. |
| Within 1 hour | Open an incident record (template below); tell the incident lead. |
| **Within 24 hours** | Notify every affected institution in writing. As operator we must do this *immediately* (POPIA s 21(2)), so don't wait for the full picture. Use the time in the operator agreement if it's shorter. |
| As soon as reasonably possible | The institution, as responsible party, notifies the **Information Regulator** (eServices portal, security compromise notification) and the affected people. We give them everything they need, and draft the notices for them. |
| Within 7 days | Root cause found, fix deployed, tests added so it can't recur. |
| Within 30 days | Post-incident review shared with affected institutions. |

## Containment checklist

- **Leaked key or secret:**
  - rotate it (Supabase → Settings → API; Vercel environment variables);
  - for the push secret, run `select uniattend.set_push_secret('<new>')` and update Vercel and the cron job;
  - redeploy.
- **Compromised account:**
  - suspend the role (`set_role_status`);
  - sign the user out everywhere (Supabase → Authentication → Users → the user → sign out);
  - force a password reset.
- **Access-control bug:**
  - fix the policy with a migration;
  - write a test proving the hole is closed;
  - check `audit_logs` and the Supabase logs (Logs → API, Postgres) to see what was read, by whom and since when.
- **Lost device with an export:** list which institutions and people the export covered.
- **Institution-level risk:** suspend the institution on `/super` (data is kept, access stops) while investigating.

## What the notices must say (s 22(5))

1. What happened, and when.
2. What information was involved.
3. What has been done, and what will be done.
4. What the person can do to protect themselves (e.g. change their password, watch for phishing).
5. Who to contact (the Information Officer's details).
6. If known, who accessed it.

## Incident record template

```
Incident ID:             (date + short name)
Reported by / when:
Discovered how:
What happened:
Personal information involved (categories, institutions, approx. number of people):
Start and end of exposure:
Containment steps and times:
Institutions notified (who, when, how):
Regulator notified by institution (date, reference):
Data subjects notified (date, how):
Root cause:
Fix and tests added:
Lessons and follow-ups:
Closed (date, by):
```

Keep incident records for at least five years, even when no notification was needed.
