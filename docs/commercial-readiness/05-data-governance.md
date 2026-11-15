# 05 — Data governance (POPIA and PAIA)

*15 November 2026. Not legal advice. Everything here is prepared for review by a South African attorney with POPIA experience and by each university's Information Officer. Nothing in this document, or in the app's legal pages, has been approved by an attorney yet. Status words as in [01-technical-audit.md](01-technical-audit.md).*

## 1. Who is responsible for what

| Party | POPIA role | Responsible for |
|---|---|---|
| **The university** | Responsible party | Deciding why attendance is recorded and for how long; its students' and staff's rights requests; its own privacy notice; its Information Officer; telling the Regulator and data subjects about a breach. |
| **Webbex Solutions (Pty) Ltd** (UniAttend) | Operator (s 20–21) for university data; responsible party for its own account and billing data | Processing only on the university's instructions; security safeguards (s 19); telling the university without undue delay about a suspected breach; returning or deleting data at the end. |
| Sub-operators | Operators of Webbex | Listed in §4 and on `/privacy`. |

The operator agreement that sets this out is a draft: [`docs/legal/operator-agreement-draft.md`](../legal/operator-agreement-draft.md). **It must be signed with each university before go-live.** The go-live checklist (migration 0032) does not track the signed agreement; UniAttend must check it before approving go-live.

## 2. What is collected, why, and how long it is kept

| Data | Why | Kept | Status |
|---|---|---|---|
| Student: number, name, email, enrolments, group | Know who is in which class | University's retention period after removal | Implemented |
| Lecturer: staff number, name, email, assignments | Who teaches and may open attendance | Name and email removed after the period; the record stays so past classes show who ran them | Implemented |
| Attendance record per class: status, time, method, score, reasons, decisions | The purpose of the system | University's period, from the class's close | Implemented |
| Check-in evidence: QR step, **distance from the venue and GPS accuracy** (not coordinates), device check result | Show why a check-in was accepted or sent for review | Same as the record | Implemented |
| Device check: a SHA-256 hash, not a device identifier | Spot one phone checking in several students | Same as the record | Implemented |
| Account: email, name, password (handled by Supabase Auth, never seen by UniAttend) | Sign-in | Until the person asks for deletion | Implemented |
| Fingerprint or face (app lock) | Unlock the app on the phone | **Never leaves the phone; UniAttend receives nothing** | Implemented |
| Audit log: who did what and when | Accountability (s 17), disputes | University's period | Implemented |
| Push-notification address | Deliver notifications the person turned on | Until turned off or invalid | Implemented |
| Integration credentials (Moodle token, roster link token, API key hash) | Read the university's systems | Until replaced, revoked or the connection is deleted; encrypted (AES-256-GCM) | Implemented |
| Walking-directions request: two coordinates | "Find my class" | Not stored; sent to OpenRouteService without any identity | Implemented |

The retention schedule is [`docs/legal/retention-schedule.md`](../legal/retention-schedule.md). Each university sets its own period (default 3 years) in **Policy → Keeping records**; `retention_preview()` shows what is due, `apply_retention()` deletes it (audited), and `auto_retention` runs it nightly. **It is off by default:** the university decides when its records are deleted. **Academic records the university is legally required to keep are never deleted by UniAttend on its own initiative.**

## 3. Rights of data subjects

| Right (POPIA) | How | Status |
|---|---|---|
| Access (s 23) | "Download my data" on the Security page: everything held about the signed-in person, as JSON. Audited. | Implemented, tested |
| Correction, deletion, objection (s 24, s 11(3)) | Request on the Security page → the university's admins (`/admin/requests`) and UniAttend (`/super/requests`) see it, with a 30-day clock; the outcome is recorded. | Implemented |
| Attendance disputes | Students dispute any absent, late or pending record; lecturers or officers decide; audited. | Implemented, tested |
| Leaving an institution | The person leaves; their roles there stop; recorded. | Implemented |
| Institution's own access and portability | Full export: every table as CSV in a ZIP (migration 0032). Audited. | Implemented, tested |

## 4. Sub-operators and cross-border transfer

From `SUB_OPERATORS` in `src/lib/legal.ts` (shown on `/privacy`):

| Who | For | Where | Data |
|---|---|---|---|
| Supabase Inc. | Database, sign-in | EU (Ireland, `eu-west-1`) | All account and attendance records |
| Vercel Inc. | Runs the app | Global network | Requests in transit; short-lived logs |
| Google, Apple, Mozilla push services | Notifications, if turned on | Global | Notification text and a device address |
| Cloudflare (Turnstile) | Bot check at sign-in, if switched on | Global | Browser signals; no account data |
| HeiGIT gGmbH (OpenRouteService) | Walking directions | Germany | Two coordinates; no identity |
| OpenStreetMap tile servers | Map images | Global | IP address |

**Data is stored outside South Africa (EU).** Section 72 allows this where the recipient is bound by adequate protection (the EU's GDPR) or by agreement. **Open question for the attorney (Q2 below):** whether to rely on s 72(1)(a) and the providers' data processing agreements, or move to a South African region before the first university signs. The Supabase and Vercel DPAs must be accepted and kept on file (not yet done).

## 5. Security incidents

The breach response plan is [`docs/legal/breach-response-plan.md`](../legal/breach-response-plan.md): contain, assess, notify the university without undue delay so it can notify the Regulator and data subjects (s 22), record. **Its roles table (names and phone numbers) is not filled in.**

The one incident-class finding so far — the legacy prototype role escalation (S1 in [03-security-review.md](03-security-review.md)) — affected only the prototype's own tables, not UniAttend data, and was fixed on 15 November 2026. Whether it needs any notification is a question for the attorney (Q5).

## 6. Accountability features in the product

- Audit log of role changes, corrections, review decisions, exports, imports, onboarding sign-offs, credential revocation, exit and closure. No app role can edit or delete it (only the retention job, which logs itself).
- Auditor role (0030): read-only access to records, decisions, the audit log and role assignments.
- Every data download is logged before it is sent (0028, 0031, 0032).
- Integration administrators cannot read attendance or student lists (0030).
- UniAttend staff cannot see a university's students, lecturers, attendance, evidence, reviews, reports or institution audit entries unless the university's own administrator grants support access (1 hour to 7 days, withdrawable at any time, audited, staff notified). While a grant is active, staff act as an administrator and every action is in the university's audit log (migration 0034). Without a grant the platform sees only what it needs to run the service: institution details, plans and billing, onboarding progress, campus setup, administrators' contact details, and data-subject requests addressed to UniAttend.

## 7. Institutional data ownership and exit

The university owns its data. It can download all of it at any time, delete every stored credential at once, and ask to leave; UniAttend closes the account by archiving it and **deletes nothing at that point**. Deletion follows the retention schedule and the operator agreement, on the university's written instruction (migration 0032; [04-integration-architecture.md](04-integration-architecture.md) §4).

## 8. Open items

| # | Item | Owner |
|---|---|---|
| 1 | ~~Narrow UniAttend staff's access to university records~~ — done in migration 0034 (support-access grants). | Development |
| 2 | Fill in `src/lib/legal.ts`: head of company, Information Officer, privacy and support emails, phone. | Owner |
| 3 | Register the Information Officer with the Information Regulator. | Owner |
| 4 | Accept and file the Supabase and Vercel DPAs. | Owner |
| 5 | Fill in the breach plan's roles table. | Owner |
| 6 | Professional indemnity and cyber insurance. | Owner |

## 9. Questions for the attorney

1. Is the operator agreement draft adequate for a public university, and which clauses will a university's legal office usually insist on?
2. EU hosting under s 72: sufficient with the providers' DPAs, or should data move to South Africa?
3. Does location-based verification (distance and accuracy only) need prior authorisation (s 57) or an impact assessment by the university?
4. Breach notification: what time limit should the operator agreement promise the university?
5. The legacy prototype escalation (fixed): any notification duty?
6. Liability cap and limitation clauses appropriate for the price point.
