# Phone notifications

Students get a notification on their phone (or computer) for:

| What | When | Setting |
|---|---|---|
| **Class reminder** | 15 minutes before every class on their timetable | Class reminders |
| **Attendance is open** | when a lecturer opens attendance | Attendance updates |
| **Results and decisions** | check-in sent for review, late arrival accepted or denied, corrections, disputes | Attendance updates |
| **Announcements** | when the institution (Admin dashboard → *Send an announcement*) or the platform posts one | Announcements |

Each notification shows the **institution's logo** (Design page → Header → logo link) and name, with buttons such as
*Check in now* or *Show venue*. Everything also appears on the redesigned **Notifications** page.
Students turn notifications on from the banner on their dashboard or on the Notifications page, and can switch
each type on or off per device.

**Where it works:** Chrome, Edge, Firefox and Samsung Internet on Android and computers. On iPhone (iOS 16.4+),
after *Share → Add to Home Screen*. In the **Android app**, class reminders are scheduled on the phone itself
from the timetable, and work offline. Announcements and attendance updates appear in the app's Notifications list.
Pushing those to the app needs Firebase Cloud Messaging, which is a later step.

## Set up (once)

1. **Database:** run `supabase/migrations/20261109000011_push_notifications.sql` in the Supabase SQL Editor
   (after 0010).
2. **Keys:** in Vercel → Settings → Environment Variables, add these four values from your local `.env.local`
   (or make new ones with `npx web-push generate-vapid-keys`), then redeploy:
   `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_DISPATCH_SECRET`.
   The private key and secret are secrets: never paste them in chat or commit them.
3. **Every-minute sender:** open `supabase/push-schedule.sql`, replace `<SITE>` with your address and `<SECRET>`
   with `PUSH_DISPATCH_SECRET`, and run it in the SQL Editor. It stores the secret's hash and asks Supabase
   (pg_cron + pg_net) to call `/api/push/dispatch` every minute.
4. **Vercel Deployment Protection must be off** for the site (Settings → Deployment Protection), or the
   every-minute call is blocked by Vercel's login, just like students would be.

Notifications created by lecturer and admin actions are also sent straight away, without waiting for the minute.

## How it works

- `notifications` rows are the single source: the database creates them (attendance, decisions, announcements via a
  trigger, class reminders via `queue_class_reminders()`).
- `push_claim(secret)` hands the sender unsent notifications plus each recipient's devices and the institution's
  logo, and marks them sent. Anything older than an hour is never pushed.
- `src/lib/push.ts` encrypts and sends with Web Push (VAPID); dead subscriptions are removed automatically.
- `public/sw.js` shows the notification and opens the right page when it is tapped.
