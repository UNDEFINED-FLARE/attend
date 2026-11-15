# Internal controls: misused / borrowed admin accounts

Added 2026-11-15 (migration `0008_internal_controls`, Edge Function `step-up`). Protects against a
borrowed logged-in session, a shared or stolen admin password, or an admin who oversteps — without
nagging on every click. Chosen level: **alerts + step-up** (no authenticator app, for now).

## What is enforced, and where

Everything is enforced in the **database**, so a modified app or a direct API call cannot skip it.
94 tests pass, including 11 new ones in `tests/db/internal-controls.test.ts`.

### 1. Step-up ("confirm it's you") — friction only on the dangerous actions
`grant_role`, `set_role_status`, `change_subscription` and `set_institution_status` now require that
the caller confirmed their password within the last **20 minutes**. Everyday admin work (viewing,
attendance, routine edits) asks for nothing. The database raises error code **P0004** when a
confirmation is needed; the app catches that, shows the password prompt, and retries.

Only the `step-up` Edge Function (service role) can record a confirmation, and only after
re-checking the password, so nobody can grant themselves step-up from the client.

### 2. Alerts — passive, so misuse is seen within seconds
- Adding or changing a role notifies the **other** admins and the **person affected** (not the actor).
- A subscription change notifies the institution's admins.
- A sign-in from a **new device** on an admin/super-admin account alerts the owner
  ("…If this was not you, change your password and sign out everywhere.").

### 3. Damage limits
- The **last active administrator** of an institution cannot be suspended or removed.
- An admin cannot suspend their **own** access (unchanged from before).

## To finish (not yet wired into the UI)

1. **Deploy the Edge Function:** `supabase functions deploy step-up` (keep JWT verification on).
2. **Client — step-up prompt:** when an admin action returns Postgres code `P0004`, show a small
   "Confirm it's you" password dialog, POST the password to the `step-up` function, then retry the
   action. (Everyday actions never hit this.)
3. **Client — new-device alert:** after sign-in, call `select public.note_sign_in($device_hash, $label)`
   once, using the same device fingerprint the check-in flow already computes.
4. **Client — "sign out everywhere":** a button on a security settings page calling
   `supabase.auth.signOut({ scope: 'global' })`, and `select public.clear_step_up()` so the next
   dangerous action must re-confirm. This kills a borrowed or stolen session.

## Later, if wanted
Add an authenticator app (TOTP) for admins; step-up would then take a 6-digit code instead of the
password, so even a stolen password is useless. This is a one-time setup per admin.
