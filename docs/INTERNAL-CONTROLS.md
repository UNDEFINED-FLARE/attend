# Internal controls: step-up + new-device alerts

Added 2026-11-16 (migration `0035_internal_controls`, Edge Function `step-up`). These are the two
pieces main didn't already have, for protecting against a borrowed logged-in session, a shared or
stolen admin password, or an admin overstepping. Main already has the rest (membership-consent
alerts, last-admin guard, app-lock, support-access least privilege).

**Safe to merge and deploy as-is.** Step-up enforcement is gated by a platform flag that is **off by
default**, so nothing changes until a super admin turns it on *and* the thin UI below is wired.
286 tests pass.

## 1. Step-up ("confirm it's you") — off until enabled

When enabled, changing a privileged role (any admin/staff power role) for **another** person —
`grant_role`, `set_role_status` — requires the actor to have confirmed their password in the last
20 minutes. Everyday work, and self-service (signing up, linking your own account, leaving), ask for
nothing. Enforced by a trigger on `uniattend.user_roles`, so it holds whatever path makes the write.
The database raises code **P0004** when a confirmation is needed.

Only the `step-up` Edge Function (service role) can record a confirmation, and only after re-checking
the password — so nobody can grant themselves step-up from the client.

## 2. New-device sign-in alerts

`uniattend.note_sign_in(device_hash, label)` records the device and, for an admin/staff account that
already has a known device, notifies the owner on a new one ("…if this wasn't you, change your
password"). Writable only through that function, so a borrowed session can't mark itself "known".

## To turn it on (after merge)

1. **Run the migration** on the project (`0035_internal_controls`). Until it runs, `/api/health`
   reports "degraded" (by design — it flags the pending migration).
2. **Deploy the Edge Function:** `supabase functions deploy step-up` (keep JWT verification on).
3. **Wire the thin UI** (small, listed below).
4. **Enable it:** a super admin calls `select uniattend.set_step_up_enabled(true)` (or add a toggle).

Steps 1–2 change no behaviour on their own (flag off). Enforcement begins only at step 4, so don't
enable it until the UI (step 3) is in, or admins will be blocked from role changes with no prompt.

## The thin UI to wire (step 3)

- **Step-up prompt:** when a server action's RPC returns Postgres code `P0004`, show a small
  "Confirm it's you" password dialog, `POST` the password to the `step-up` function, then retry the
  action. Only the dangerous actions ever hit this.
- **New-device ping:** after sign-in, call `select uniattend.note_sign_in($hash, $label)` once, with
  a device id kept per browser (e.g. a long-lived httpOnly cookie set on first sign-in) and the
  User-Agent as the label.
- **Sign out everywhere:** a button calling `supabase.auth.signOut({ scope: 'global' })` and
  `select uniattend.clear_step_up()`, so a borrowed/stolen session is killed and the next dangerous
  action re-confirms.

## Later, if wanted
Require an authenticator app (TOTP) for admins; step-up would then take a 6-digit code instead of the
password, so even a stolen password is useless.
