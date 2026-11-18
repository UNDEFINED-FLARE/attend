# 04 — Integration architecture

*15 November 2026, `main` with migration 0033. Status words as in [01-technical-audit.md](01-technical-audit.md). No connector has been tested against a real university system yet.*

UniAttend does not replace a university's student system (SIS), learning system (LMS) or timetable system. It takes what it needs from them — modules, people, enrolments, lecturer assignments, timetable — and keeps attendance.

## 1. Ways data comes in

| Method | How | Status |
|---|---|---|
| **Moodle web services** | UniAttend calls `core_webservice_get_site_info`, `core_course_get_courses`, `core_enrol_get_enrolled_users` with a read-only token, on a schedule or on demand. | Implemented; the mapping of Moodle courses and participants is unit-tested with sample responses. **Blocked:** never run against a real Moodle; needs a site and token. |
| **Scheduled CSV/JSON link** | The university publishes an export at an https address; UniAttend fetches it hourly or daily, optional bearer token. | Implemented, tested. |
| **Institution API v1** | The university's system pushes to `POST /api/v1/roster` with an API key. Retry-safe (Idempotency-Key), status and run endpoints, one error format. Public docs at `/developers`. | Implemented, tested (database and unit). Not yet called by a real university system. |
| **Legacy push** | `POST /api/roster` — same as v1 without retries or the error shape. Kept for compatibility. | Implemented, tested. |
| **Import Centre** | An administrator uploads CSV/Excel, maps columns (mappings can be saved), previews, confirms. 11 datasets, from faculties to dated timetable events. | Implemented, tested. |
| **ITS, Banner, PeopleSoft, Blackboard, CELCAT** | Listed in the catalogue as "not available yet". They can send data today through the API, a scheduled link or the Import Centre, using their own exports. | **Blocked:** a direct connector needs an authorised test environment. |
| **University API (REST connector)** | UniAttend reads the university's own JSON API on a schedule: bearer token, API key header or OAuth client credentials; page-number, offset or next-link paging; a field mapping from each record to a person with modules. A test reads the first page and reports what it found. Page and offset paging resume across runs. Migration 0035. | Implemented; mapping, paging, OAuth, error and redirect handling unit-tested against a simulated server; claim and apply database-tested. **Blocked:** never run against a real university API. |

## 2. The path every record takes

```
source ──► stage ──► validate ──► match ──► preview ──► commit ──► report
           (rows     (types,      (external  (Import     (one        (run, counts,
           kept as   required,    id, then   Centre:    transaction) rejected rows,
           sent)     formats)     natural    rolled-back             audit log)
                                  key)       dry run)
```

- **Staging:** `integration_staging` keeps each row as received, per run.
- **Matching:** first by the source's own id (`integration_external_ids`), then by natural key: student number, staff number or email, module code. A changed email therefore updates the person instead of creating a duplicate.
- **Preview:** the whole commit runs inside a subtransaction that is rolled back (`UA001`), so the counts shown are exactly what confirming will do.
- **Commit:** one transaction. A failure leaves the register as it was.
- **Report:** `integration_runs` (status, summary), `integration_errors` (rejected rows with reasons, downloadable as CSV), audit log entries.

The roster push and the scheduled sources use `roster_apply()` for the same rules in one step (no preview: they are machine-to-machine).

## 3. Data-safety rules

1. **Nothing is deleted because it is missing** from an incomplete import.
2. Enrolments are dropped only when a source says its roster is **complete** *and* the connection allows it, and only enrolments **that connection created**. Dropped means status `dropped`, never deleted; **attendance history is always kept**.
3. If a complete roster would drop most of a connection's students at once, or lists nobody, **nothing is dropped**; the count is reported as `held_back` for a person to check.
4. Re-importing the same data changes nothing (tested).
5. Hand-made timetable changes are never overwritten by the nightly refresh; a timetable system's own update of its own event applies.
6. Every run is recorded and visible to the institution's administrators and integration administrators.

## 4. Security

| Concern | Control |
|---|---|
| Which institution | The API key (stored as SHA-256) or the signed-in administrator decides it; never a field in the request. |
| Credentials at rest | Moodle and link tokens are encrypted in the app with AES-256-GCM (`INTEGRATION_ENCRYPTION_KEY`) before they reach the database; the `integration_secrets` table has no read access for any app role. |
| Credentials in transit | HTTPS only; tokens are sent in request bodies or headers, never URLs. |
| SSRF | Outbound fetches: https only, private, loopback and link-local addresses refused after DNS resolution and on every redirect; 30-second timeout; 25 MB cap. |
| Abuse | 120 pushes per connection per hour; 20 MB and 20,000 people per request. |
| Retries | Idempotency keys per connection, kept 7 days; the same key with another body is refused. |
| Who can configure | Institution administrators and integration administrators (0030). Integration administrators cannot read attendance or student lists. |
| Leaving | One action deletes every stored credential and pauses every connection (0032). |

## 5. Operating it

- **Health:** `/api/health` reports failed or late background jobs (the integration worker runs inside `uniattend-push`).
- **Activity:** Integrations → Activity lists every run with counts and rejected rows.
- **From the university's side:** `GET /api/v1/status` shows recent runs for their key.

## 6. What a university needs to provide

| For | Needs |
|---|---|
| Moodle | Web services and REST enabled, a service with the three functions above, a user with read access to courses and participants, a token. |
| Scheduled link | An https address of a CSV or JSON export, optionally a bearer token. |
| University API | The https address of a JSON endpoint listing people with their modules, a read-only credential (token, API key or OAuth client), and which fields hold the number and module codes. |
| API | Someone to call `/api/v1/roster` from their SIS or middleware; an API key from an administrator. |
| Any SIS (ITS, Banner, PeopleSoft) or CELCAT directly | An authorised test environment and documentation; until then, their own exports through one of the methods above. |
