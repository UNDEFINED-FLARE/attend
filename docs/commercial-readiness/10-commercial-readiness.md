# 10 — Commercial readiness

*15 November 2026. Webbex Solutions (Pty) Ltd, registration 2026/690092/07.*

**Summary: the product can support a pilot and an institutional evaluation. It cannot yet support a paid contract:** there are no prices, payments are manual only, there is no support desk, the legal documents are unreviewed, and nothing has been proven with a university.

## 1. Product readiness, by area

| Area | Ready for evaluation | Ready for a paid contract | Evidence |
|---|---|---|---|
| Attendance (QR, location, device, late, offline, review queue, disputes) | Yes | After the pilot | Database tests; review queue live (0029) |
| Integrations (Import Centre, Moodle, scheduled link, API v1) | Yes | After one real connection | 0024–0026, 0033; `/developers` |
| Timetable (dated classes, changes, groups) | Yes | After the pilot | 0027 |
| Roles (faculty, department, officer, integration, auditor) | Yes | Yes | 0030; permission tests |
| Reporting and exports (Excel, CSV, PDF) | Yes | After a real-size check | 0031 |
| Onboarding and exit | Yes | Yes | 0032 |
| Governance (rights requests, retention, audit) | Yes | After attorney review | [05-data-governance.md](05-data-governance.md) |
| Infrastructure | No (free plan, shared, no backups) | No | [06-production-readiness.md](06-production-readiness.md) |
| Mobile | Debug build only, untested on phones | No | [08-mobile-test-report.md](08-mobile-test-report.md) |

## 2. Plans and billing

| Item | Now | Needed |
|---|---|---|
| Plans | Starter, Professional, Enterprise exist, yearly | **Prices are not set** (`price_cents` is empty on all three) |
| Plan limits | Students and lecturers enforced by the database | **Fix:** Starter allows 15,000 modules but Professional only 2,000 — the limits are inconsistent |
| Plan features | Flags exist (`bulk_import`, `exports_pdf`, `advanced_analytics`…) | **Decide:** the new reports, exports and roles are available on every plan; the flags do not gate them |
| Trials | 30 days on request; the three live institutions' trials end 8–9 December 2026 | Extend or convert before then |
| Payments | Manual payments recorded by UniAttend (0022) | Paystack webhook is designed (0012) but **not deployed**; until it is deployed and tested in Paystack's test mode, invoice by EFT |
| Payment safety | A payment is only recorded server-side; a browser redirect never marks anything paid | Keep |

## 3. Support and service

| Item | Status |
|---|---|
| Support channel | Not set up: needs an email address, a phone number and hours (also required in `src/lib/legal.ts`) |
| Ticketing | Missing (P2): use a shared mailbox or a helpdesk tool for the pilot rather than building one now |
| Service levels | **Do not promise an uptime figure** until monitoring, backups and a dedicated database are in place and some months of measurements exist |
| Status of the service | `/api/health` (machine-readable); a public status page is open |
| Guides | Admin, lecturer and student guides in `docs/`; integration docs at `/developers` |
| Incident response | Breach plan drafted; roles table empty |

## 4. What a university's ICT and procurement will ask for

| Request | Answer today |
|---|---|
| Architecture and data flow | [01-technical-audit.md](01-technical-audit.md), [04-integration-architecture.md](04-integration-architecture.md) |
| Security controls and findings | [03-security-review.md](03-security-review.md) (internal review; **no independent penetration test**) |
| POPIA position, operator agreement, sub-operators, data location | [05-data-governance.md](05-data-governance.md); drafts in `docs/legal/` |
| Backups, recovery, availability | Targets in [06-production-readiness.md](06-production-readiness.md); **not yet achieved** |
| Capacity | [07-load-test-report.md](07-load-test-report.md); **not yet tested** |
| Exit and data portability | Built: full export, credential revocation, closure without deletion (0032) |
| References | None yet |
| Company documents | CIPC registration; B-BBEE affidavit, tax clearance and CSD registration are commonly required by South African public universities and should be prepared |

## 5. Next commercial steps

1. Set prices for each plan and fix the plan limits.
2. Prepare the procurement pack: company registration, B-BBEE affidavit, tax compliance, CSD number, insurance, the documents in §4.
3. Finish the P0 production items and the legal items.
4. Agree the UNIVEN pilot in writing (scope, data permission, operator agreement, success criteria from [09-pilot-readiness.md](09-pilot-readiness.md)).
5. After the pilot: a written reference and a decision by the budget owner. **Commercial validation is only real when someone with a budget agrees to pay.**
