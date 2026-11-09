# UniAttend

Multi-institution attendance platform for universities. Lecturers open a session and project a QR code that is
re-signed every 20 seconds. Students scan it, and the database scores the check-in from three kinds of evidence:
the signed token, the student's location relative to the mapped venue, and a privacy-preserving device hash.
Weak evidence sends a check-in to the lecturer for review. It is never turned into an absence automatically.

- **Stack:** Next.js 15 (App Router, TypeScript, Tailwind v4) · Supabase (Postgres, Auth, Realtime, Edge Functions) · Vercel
- **Tenancy:** everything lives in the `uniattend` Postgres schema; every institution-owned row has `institution_id`; Row Level Security on every table; composite foreign keys stop a row pointing at another tenant's parent.
- **Status:** see [`docs/02-ROADMAP.md`](docs/02-ROADMAP.md). The audit of the earlier versions is in [`docs/01-AUDIT.md`](docs/01-AUDIT.md).

## Run it locally

```bash
npm install
cp .env.example .env.local   # fill in your Supabase URL and anon key
npm run dev
```

QR scanning and geolocation need HTTPS on phones. To test on a real phone, deploy a Vercel preview, or run
`npx next dev --experimental-https` and open the LAN address.

## Set up Supabase (once per environment)

UniAttend installs into its own Postgres schema, **`uniattend`**. The pilot runs on the Supabase project
named `acvosa` (`rbnnbmduwrvokhbkezyh`). The ACVOSA app that used to live in that project's `public` schema is
removed with `supabase/remove-acvosa.sql`. The legacy UniAttend tables (`public.aa_*`) are kept there for a later
import into the new schema.

1. **Install the schema.** Open Supabase → SQL Editor, paste the whole of `supabase/install-uniattend.sql`, and run it.
   It is a single transaction (all or nothing) and refuses to run twice. Regenerate it after changing migrations
   with `npm run bundle:sql`. With CLI access, `npx supabase db push` applies the same migrations.
2. **Expose the schema to the API.** Project Settings → API (Data API) → *Exposed schemas* → add `uniattend` → Save.
   Without this, every app request fails with "schema must be one of the following".
3. **Auth → Providers → Email:** keep *Confirm email* **on**. Student and lecturer access is linked to confirmed
   emails only. Turning confirmation off would let someone register with another person's address.
4. **Auth → URL configuration:** Site URL = your deployment URL; add `<site>/auth/callback` to redirect URLs.
5. **Make yourself super admin.** Sign up through the app first, then run this in the SQL editor:
   ```sql
   insert into uniattend.profiles (id, email) select id, email from auth.users where email = 'you@example.com'
     on conflict do nothing;
   insert into uniattend.user_roles (user_id, role)
   select id, 'super_admin' from auth.users where email = 'you@example.com';
   ```
6. **Set up each institution.** The code has no institution built in. When an institution registers, open
   Super → Institutions → *Set up*: apply its entry from Super → Directory (campus maps and timetable link;
   14 institutions are seeded), adjust the map, test the timetable source, then approve.
7. Optional, for payments: `npx supabase functions deploy paystack-webhook --no-verify-jwt` and
   `npx supabase secrets set PAYSTACK_SECRET_KEY=...`.

No storage buckets are needed yet. Logos will go in a public `branding` bucket (Phase 6).

## Deploy to Vercel

Import the GitHub repo in Vercel, set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
`NEXT_PUBLIC_SITE_URL`, and deploy. **The service-role key is never set in Vercel.** The app does all privileged
work through `SECURITY DEFINER` functions that check `auth.uid()`.

## Tests

```bash
npm run test:db     # migrations + RLS + attendance engine, against real Postgres (PGlite), no Docker
npm run typecheck
npm run lint
npm run build
```

`tests/db/platform.test.ts` covers: roles cannot be self-assigned; Institution A cannot read or write
Institution B through any table or function; forged and stale QR tokens are rejected; duplicate check-ins are
blocked; GPS outside the venue goes to review, not absence; one phone checking in two students is flagged;
students cannot write attendance; closing marks only no-shows absent; corrections need a reason and are
audited; disputes; the report arithmetic; plan limits; suspension.

## How it fits together

| Concern | Where |
|---|---|
| Schema, tenancy | `supabase/migrations/…0001_core.sql`, `…0002_attendance.sql`, `…0003_saas.sql` |
| RLS | `…0004_rls.sql` |
| Check-in scoring, QR signing, sessions, reports, import | `…0005_functions.sql` |
| Session refresh, sign-in redirect | `src/middleware.ts` |
| Role gate per area | `src/lib/auth.ts` → `requireRole()` in each `layout.tsx` |
| Student check-in UI | `src/app/student/check-in/` |
| Lecturer live register | `src/app/lecturer/sessions/[id]/` |
| Payment webhook | `supabase/functions/paystack-webhook/` |

### Check-in scoring

| Layer | Points | Notes |
|---|---|---|
| Session proof | 40 (QR) / 15 (typed code) | HMAC-SHA256 over `session:step`, 20 s steps, current or previous step accepted. Required. Without it the attempt is rejected and nothing is recorded. |
| Location | 0–40 | Logistic probability of being inside the venue's boundary or radius, given the phone's reported accuracy. Too imprecise is capped at 8; uniform synthetic readings are capped at 10. Coordinates are **not stored**; only distance and accuracy are kept. |
| Device | 0–20 | SHA-256 of a random on-device id. 0 if this device already checked in another student this session. |

Score = earned / available × 100 (location is left out when the venue is unmapped). At or above the
institution's accept score (default 70) the check-in is **present**, or **late** after the late threshold.
Below it, the status is **pending verification** for the lecturer to decide.

## Guides

- [Institution administrators](docs/guide-admin.md)
- [Lecturers](docs/guide-lecturer.md)
- [Students](docs/guide-student.md)
