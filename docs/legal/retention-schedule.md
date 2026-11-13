# Retention schedule

Each institution sets its retention period (Admin → Policy & branding → *Keep records for*, 30–3,650 days; default **1,095 days, three years**). That period applies to everything below unless a row says otherwise.

Deletion happens in one of two ways:

- **Manual:** an institution admin uses *Delete records past the period now*.
- **Nightly:** if the institution turns on *Delete old records automatically*, the job `uniattend-retention` runs at 02:30 South African time.

Either way, the clean-up is logged in the audit log.

| Record | Kept for | How it ends | Notes |
|---|---|---|---|
| Class sessions, attendance records, check-in evidence, check-in events, disputes | Institution period, counted from when the session closed | Deleted | The core attendance record. The institution may need longer for academic appeals; set the period to match its own records policy. |
| Notifications | Institution period | Deleted | |
| Announcements | Institution period | Deleted | |
| Early-warning alerts | Institution period after being resolved | Deleted | Open alerts are kept until resolved. |
| Audit log entries | Institution period | Deleted | The clean-up's own entry is kept. |
| Student records removed from the register | Institution period after removal | Deleted (with their enrolments and records) | |
| Lecturer records removed from the register | Institution period after removal | Name and email removed; the record stays | So past sessions still show who ran them. |
| Saved design versions | Last 30 | Older ones deleted on publish | No personal information. |
| Push-notification addresses | Until the person turns notifications off, or the address stops working | Deleted | |
| Location during check-in | Not stored | – | Only the distance from the venue and its accuracy are kept, as check-in evidence. |
| Ambient-sound fingerprints (if enabled) | Until compared | Deleted straight away | |
| Login accounts | Until the person asks to delete them | Deleted by support (Supabase → Authentication → Users) | Institution records stay until their own period ends. |
| Backups (paid Supabase plan) | 7 days (Pro plan) | Overwritten | So deleted records are fully gone within about a week. |
| Server logs (Vercel, Supabase) | The provider's retention (days) | Automatic | |
| Company records (finance, staff) | As the law requires (generally 5–7 years) | Deleted after | See the PAIA manual, section 4. |

When a contract ends, the institution's data is exported for it on request within 30 days, then deleted, including from backups within the backup period.
