# UniAttend operator agreement: draft for legal review

> **Not legal advice.** This is a working draft for a South African attorney to review and complete before any
> institution signs. Square brackets mark the points that need a decision. It reflects how UniAttend actually works
> on 13 November 2026; if the system changes, update Schedule 2.

**Parties**
- **The Institution:** [legal name, registration number, address], the *responsible party* under the Protection of Personal Information Act 4 of 2013 (POPIA).
- **The Provider:** [legal name of the company operating UniAttend, registration number, address], the *operator* under POPIA.

## 1. Purpose

The Provider supplies UniAttend, an attendance-recording service, to the Institution. The Provider processes personal information **only on the Institution's documented instructions**, for the purpose of recording and reporting class attendance and the related functions the Institution switches on (Schedule 1). The Provider does not use it for any other purpose, sell it or use it for marketing.

## 2. Provider obligations (POPIA sections 20 and 21)

1. Process personal information only with the Institution's knowledge and authorisation, and treat it as confidential.
2. Maintain the security measures in Schedule 2, and review them at least yearly.
3. **Notify the Institution without undue delay, and within [24/48] hours**, when there are reasonable grounds to believe personal information has been accessed or acquired by an unauthorised person (section 22), with what is known and the steps taken.
4. Help the Institution answer data-subject requests (access, correction, deletion, objection) within [10] business days.
5. Ensure staff with access are bound by confidentiality and access data only to provide support.
6. Use the sub-operators in Schedule 3 only, under written terms giving equivalent protection, and give [30] days' notice of changes so the Institution can object.
7. On termination, return the Institution's data in a standard format (CSV/JSON export, available in the product) within [30] days, then delete it, including from backups within [90] days, and confirm deletion in writing.
8. Allow the Institution, on reasonable notice, to verify compliance (questionnaire, reports, or audit at the Institution's cost).

## 3. Institution obligations

1. Have a lawful basis for the processing and give students and staff the privacy notice (a template is in the product at `/privacy`).
2. Decide the retention period (default: three years) and the features enabled (location checks, sound checks, early-warning alerts).
3. Keep its administrator accounts secure, and remove access for people who leave.
4. Make attendance decisions itself; UniAttend provides evidence and records.

## 4. Cross-border transfer (section 72)

Data is stored with Supabase in the **European Union (Ireland, region eu-west-1)**, and served through Vercel's global network. The EU's GDPR gives protection substantially similar to POPIA. The Institution consents to this transfer. [Alternatively: the Provider moves hosting to a South African or other agreed region before go-live.]

## 5. Service, fees and liability

[Plan, fees (per student per year or per institution), invoicing, payment terms, service levels (availability target, support hours, response times), limitation of liability, insurance, term and termination, dispute resolution, governing law (South Africa).]

---

## Schedule 1: Personal information processed

| Category | Data | Source |
|---|---|---|
| Students | name, student number, email, module enrolments, attendance records, check-in evidence (QR result, distance from venue and accuracy (not coordinates), device hash, times), disputes, early-warning alerts | Institution imports; the student's own check-ins |
| Staff | name, staff number, email, modules taught, actions taken (corrections, overrides), audit log | Institution |
| Optional | push-notification address (if the person turns notifications on); ambient-sound fingerprints (if enabled, deleted once compared) | The person's device |

Not processed: ID numbers, biometric data (fingerprint/face unlock is checked by the device and never reaches UniAttend), precise location history, photos.

## Schedule 2: Security measures (as built)

- Each institution's data separated by database row-level security on every table; tested automatically against cross-institution access.
- Roles granted by the institution; nobody can grant themselves a role, and nobody can be added to an unapproved institution.
- Encryption in transit (HTTPS/TLS) and at rest (provider-managed).
- Rotating, signed QR codes; rate limits on check-in; device-reuse detection.
- Audit log of administrative changes and attendance corrections.
- No service-role credentials in the web app; secrets held in the hosting provider's environment settings.
- Retention clean-up built in: deletion of records past the Institution's period, by its admins or nightly, logged (`docs/legal/retention-schedule.md`).
- Data-subject tools: "Download my data" for every user; correction, deletion and objection requests routed to the Institution's admins, with a 30-day clock.
- Breach response procedure (`docs/legal/breach-response-plan.md`) and an information security policy (`docs/legal/information-security-policy.md`).
- [Daily backups with point-in-time recovery: requires the paid database plan.]
- [Error monitoring and uptime alerts: being set up.]
- Optional on-device app lock (fingerprint/face) and bot protection on sign-up and sign-in.

## Schedule 3: Sub-operators

| Sub-operator | Purpose | Location |
|---|---|---|
| Supabase Inc. | Database, authentication, file storage | EU (Ireland) |
| Vercel Inc. | Web hosting | Global edge; functions [region to confirm] |
| [Email provider, e.g. Resend] | Account emails | [ ] |
| Cloudflare (Turnstile), if enabled | Bot protection on sign-in | Global |
| Google / Apple / Mozilla push services | Delivering phone notifications | Global |
| HeiGIT (OpenRouteService) | Walking directions: start and end points only, no identity | Germany |
| [Paystack], if used | Payments by the Institution | [ ] |

## Outstanding for the Provider (not code)

- Register the company; register an Information Officer with the Information Regulator.
- Decide breach-notification hours, the support SLA and fees.
- Decide on hosting region (EU vs a South African region) before signing.
- Professional indemnity / cyber insurance.
