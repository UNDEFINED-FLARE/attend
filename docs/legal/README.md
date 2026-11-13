# Legal and compliance: what exists and what's left

Not legal advice. Everything here is a working draft. **A South African attorney with POPIA experience must review it before the first institution signs.**

## What's in place (code and documents)

| Item | Where | Status |
|---|---|---|
| Privacy notice (covers POPIA s 18) | `/privacy` (`src/app/privacy/page.tsx`) | Draft, needs company details |
| Terms of service | `/terms` | Draft |
| PAIA manual (PAIA s 51) | `/paia` | Draft, needs company details |
| Operator agreement (POPIA ss 20–21, 72) | `operator-agreement-draft.md` | Draft for the attorney |
| Information security policy | `information-security-policy.md` | Draft |
| Breach response plan (POPIA s 22) | `breach-response-plan.md` | Draft; fill in names and phone numbers |
| Retention schedule | `retention-schedule.md` | Matches the app |
| Retention enforced in the app | Admin → Policy & branding → *Keeping records* | Built (migration 0023) |
| "Download my data" (POPIA s 23) | Security page | Built |
| Correction, deletion and objection requests (ss 24, 11(3)) | Security page; `/admin/requests`; `/super/requests` | Built, with a 30-day clock |
| Leave an institution | Security page | Built (migration 0021) |
| No biometric data collected | Device-only fingerprint/face check | Built and stated in the notice |
| Location minimised | Only distance and accuracy kept | Built |
| Company details in one place | `src/lib/legal.ts` | **Empty**: pages show "[to be completed]" |

## What you must do (in order)

1. **Register the company** with CIPC, if not done, and open a business bank account.
2. **Fill in `src/lib/legal.ts`**: company name, registration number, address, head, Information Officer, privacy and support emails, and phone.
3. **Register the Information Officer** (and any deputy) with the Information Regulator: the eServices portal at inforegulator.org.za. By default the head of the company is the Information Officer.
4. **Attorney review** of the privacy notice, terms, PAIA manual and operator agreement. Decide:
   - breach notice hours;
   - liability cap;
   - fees and SLA;
   - the hosting region: stay in the EU (disclosed, s 72), or move to a South African region before signing.
5. **Publish** the PAIA manual on the website (done once `/paia` is live with the details filled in).
6. **Sign an operator agreement with each institution before go-live.** Ask for their own privacy policy and Information Officer contact, and confirm their retention period.
7. **Put written terms in place with the sub-operators.** Accept the Supabase and Vercel data processing agreements (in their dashboards / legal pages), and keep copies.
8. **Fill in the breach plan's roles table** with names and phone numbers.
9. **Insurance:** professional indemnity and cyber liability.
10. **Paid hosting with backups** (Supabase Pro, dedicated project). The security policy and retention schedule assume it.
11. **Each institution should check** whether it needs a POPIA *prior authorisation* or impact assessment for location checks under its own policies. UniAttend keeps no coordinates, which helps.

## Reviewing changes

When the app starts collecting something new, or uses a new service provider:

- update `src/app/privacy/page.tsx` and `SUB_OPERATORS` in `src/lib/legal.ts`;
- update `operator-agreement-draft.md` Schedules 1–3;
- change `privacyUpdated`;
- tell institutions.
