# 09 — Pilot readiness

*15 November 2026. For a controlled pilot with one department of an authorised university (the intended first institution is the University of Venda, UNIVEN). No pilot has started; no result below has been measured.*

## 1. Shape of the pilot

| | Proposal |
|---|---|
| Scope | One department, 3–6 modules, 2–4 lecturers, 150–600 students |
| Length | 6 teaching weeks, after a 1-week dry run |
| Data | Only with the university's written permission and a signed operator agreement; real students only after the dry run passes |
| Source of truth | The university's own student system and timetable stay authoritative; UniAttend imports from them |
| Paper fallback | Lecturers keep their usual method for the first two weeks, so the pilot can be compared and nobody is disadvantaged |
| Contacts | A pilot lead in the department, the university's ICT contact, the Information Officer, and UniAttend support |

## 2. Before day one

| # | Item | Status |
|---|---|---|
| 1 | Production P0 items done ([06-production-readiness.md](06-production-readiness.md) §6): dedicated database with backups, custom SMTP, rotated secrets, monitoring, restore drill | Open |
| 2 | Operator agreement signed; Information Officer named; attorney review of the legal pages | Open |
| 3 | The go-live checklist for the institution reaches "pilot" (structure, people, timetable, policy, training) — `/admin/onboarding` | Built; one live institution already shows 8 of 12 steps done (on test data) |
| 4 | Pilot data imported through the Import Centre or a connection; the import report shows zero unexplained rejections | Open |
| 5 | Venues mapped for every pilot classroom, location accuracy checked in each ([08-mobile-test-report.md](08-mobile-test-report.md) M5) | Open |
| 6 | Real-phone tests on at least five devices from the pilot students' range | Open |
| 7 | Lecturer and student guides handed out (`docs/guide-*.md`); a 30-minute lecturer session | Guides exist; session open |
| 8 | An attendance officer or department admin assigned to work the review queue | Role exists (0030) |
| 9 | A rollback plan: if check-ins fail, lecturers mark the register by hand (always available) | Built |

## 3. What to measure

| Measure | How | Proposed target |
|---|---|---|
| Successful check-in rate | Accepted ÷ attempts, from `attendance_verification_events` | ≥ 95% |
| Failed check-in rate, by reason | Refused and review outcomes with reasons | Each reason understood and below 3% |
| Average time to check in | QR scan to accepted, from client timing (to add) or observation | < 15 s |
| Records sent to review | `review_queue`; decisions and time to decide | Decided within 48 h |
| Disputes | `attendance_disputes` | < 2% of records |
| Duplicate attempts | `outcome = 'duplicate'` | Zero accepted duplicates |
| Sync accuracy | Pilot roster vs the university's class lists | 100% of students in the right modules |
| Lecturer adoption | Classes with a register ÷ classes timetabled (`missing_registers`) | ≥ 90% by week 3 |
| Administrative time | Before/after interview with the department administrator | Measured, not assumed |
| Reliability | `/api/health` uptime; incidents | No class without a way to record attendance |

Report these weekly from the Reports page and the review queue; keep the raw numbers.

## 4. Success and stop criteria

- **Success:** the targets above for three consecutive weeks, and the department wants to continue.
- **Stop or pause:** any cross-student or cross-institution data exposure; check-in success below 85% for a week; a lecturer unable to record attendance for a class.

## 5. What not to claim

No pilot result may be quoted until it has been measured and the university has agreed to its use. Until then, the honest statement is: *"UniAttend is ready for a controlled pilot; it has not yet been proven with a university."*
