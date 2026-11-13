# Information security policy

Applies to everyone who builds, runs or supports UniAttend. Owner: the Information Officer, with the lead developer. Review yearly. Where this says "is", it describes what the system does today (13 November 2026); "must" is a rule for people.

## 1. Data isolation between institutions

- Every institution's records carry its `institution_id`. **Row-level security on every table** is the access control, not the app's screens. Pairs of keys stop a record pointing at another institution's data.
- Automated tests run on every change: they sign in as users of two institutions and prove neither can read or write the other's data.
- Changes to policies or security functions **must** come with a test, and **must** be reviewed by a second person before release.

## 2. Accounts and access

- Roles are granted per institution, never chosen by the user. Platform administrators are separate from university administrators.
- Nobody is added to an unapproved institution; people are told when they are added, and can leave.
- Passwords: at least 10 characters. Email confirmation is required, with optional CAPTCHA, an on-device app lock and a "keep me signed in" choice.
- Staff and contractors **must**:
  - use their own accounts with two-factor authentication on GitHub, Supabase, Vercel and email;
  - lose access the day they leave.
- Production data **must not** be copied to laptops or used for testing. Use the test fixtures, or a staging project with made-up data.

## 3. Secrets

- The Supabase service-role key is **never** in the web app or the repository. Privileged work runs in reviewed database functions.
- Secrets live only in Vercel and Supabase settings, and in git-ignored local files (`.env.local`, `*.local.sql`).
- If a secret is exposed, rotate it immediately and follow the breach plan.

## 4. Changes and releases

- All work happens on branches with a pull request. Automated tests and the production build must pass before merging.
- Database changes are versioned migrations, written to be safe to re-run. Destructive changes need a backup and the owner's sign-off first.

## 5. Hosting, backups and availability

- Hosting is on Supabase (database, authentication, storage) in the EU, and Vercel (web).
- **Must before charging customers:**
  - a dedicated Supabase project on a paid plan, with daily backups and point-in-time recovery;
  - a restore test every quarter, recorded.
- Monitoring: server errors go to the alert channel (`ALERT_WEBHOOK_URL`), and `/api/health` is checked by an uptime monitor.

## 6. Logging

- Administrative actions and attendance corrections are written to `audit_logs`, which users can't change.
- Logs are kept for the institution's retention period, then deleted.

## 7. Retention and deletion

See `retention-schedule.md`. Deletion runs from the database (`apply_retention` / nightly `run_retention`, if the institution switches it on) and is itself logged.

## 8. People's rights

- **Download:** "Download my data" gives a person everything held about them.
- **Requests:** requests (correct, delete, object) go to the person's institution admins and the platform administrator, and **must** be answered within 30 days.

## 9. Suppliers

- Only the sub-operators listed in the privacy notice may be used.
- Adding one needs a written agreement, a check that its protection is adequate, an update to the privacy notice and operator agreement, and notice to institutions.

## 10. Incidents

Follow `breach-response-plan.md`. Report anything suspicious straight away; nobody is blamed for reporting.
