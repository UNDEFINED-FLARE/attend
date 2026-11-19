# Release notes

## Game look, security hardening, dependency scanning and performance indexes

**Previous version:** `main` at commit `f8c6ff7` — *Merge Bluetooth check-in evidence (migration 0037)*.
That is what the live site ran before this merge. Everything below is added on top of it; nothing from
the previous version is removed.

This release merges three strands of work (`design/game-ui`, `app/play-store-ready` and the
performance indexes) into one, rebased on the current `main`.

### What's new

**1. Game look for the student app**
- The student home and the student pages now use a mobile-game-style layout (big Check-in button,
  today's classes as slots, modules as a card deck, a tab bar whose open tab lifts) drawn in the app's
  own clean style and colours. It is the default; a student can switch to the simpler look from the
  account menu, per device. Lecturer, admin and super-admin screens are unchanged.

**2. Play Store readiness and app hardening**
- Android: release builds are HTTPS-only and trust only the system certificate authorities; remote
  debugging can't ship in a release; the file provider is narrowed; release code is shrunk with R8; a
  minimum WebView is required with an "Update needed" screen for old phones.
- Web: a Content Security Policy with a per-request nonce (only the app's own scripts run); a tighter
  Permissions-Policy (microphone, payment, USB and screen capture off); `sharp` updated.
- Old and low-end phones: a "lite" mode drops animations and blur before the page draws; long lists
  skip off-screen rows.
- A public **/delete-account** page (required by Google Play) and a Play Console checklist in
  `docs/android-app.md`.

**3. Security review against real-world breaches**
- Reviewed against 2025–26 breaches of AI-built apps and universities. Findings and verdicts in
  `docs/commercial-readiness/12-threat-model-and-case-studies.md`.
- New tests lock in the guarantees: `tests/db/rls-coverage.test.ts` (every table has Row Level
  Security; secret tables and anonymous callers read nothing), `tests/db/api-keys.test.ts` (a forged or
  stolen API key can't reach other data — no IDOR — and can be rotated), `tests/unit/zip-bomb.test.ts`
  (a decompression-bomb upload is refused).

**4. Automated dependency scanning**
- `.github/dependabot.yml` and `.github/workflows/security.yml`: weekly dependency PRs and an
  `npm audit` on every push/PR (fails only on a critical production advisory). These start running once
  this is on `main`.

**5. Performance indexes**
- Migration `20261118000038_readiness_indexes.sql`: four indexes for the attendance, session and
  dispute queries the app runs most (from the 10k-readiness report).

### After merging — run this on the live Supabase

Apply the one new migration (safe; it only adds indexes):

```
supabase/migrations/20261118000038_readiness_indexes.sql
```

Until it is run, `/api/health` will report "migrations behind" (it expects schema `20261118000038`).
No other migration or deploy step is needed; all the code changes ship with the normal Vercel build.

### Still needs an owner (not code) — in priority order

1. Enable **leaked-password protection** in Supabase (Authentication → Policies).
2. Set the **Turnstile (CAPTCHA) keys** and turn on error/job alerting.
3. Enforce **MFA** for institution and super admins.
4. Turn on **Vercel's WAF / attack-challenge mode** (or Cloudflare) for volumetric DDoS.
5. Move UniAttend to its **own Supabase project** with backups and a restore drill.
6. An **independent penetration test** before any paid contract.

### Tests

All database and unit tests pass, with a clean typecheck and production build.
