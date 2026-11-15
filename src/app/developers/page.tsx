import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = { title: "UniAttend API v1", description: "Send your student system's roster to UniAttend: authentication, endpoints, retries, errors and limits." };

const Code = ({ children }: { children: ReactNode }) => (
  <pre className="overflow-x-auto rounded-xl bg-[#0b1220] p-4 text-xs leading-relaxed text-[#dbe4f3]"><code>{children}</code></pre>
);
const H2 = ({ id, children }: { id: string; children: ReactNode }) => <h2 id={id} className="mt-10 scroll-mt-6 text-xl font-semibold">{children}</h2>;
const C = ({ children }: { children: ReactNode }) => <code className="rounded bg-bg px-1 py-0.5 text-[0.85em]">{children}</code>;

const ERRORS: [string, number, string][] = [
  ["invalid_key", 401, "The key is missing, malformed, revoked or unknown."],
  ["invalid_request", 400, "The body can't be read, or a value is not allowed."],
  ["payload_too_large", 413, "More than 20 MB or 20,000 people in one request."],
  ["connection_paused", 403, "An administrator paused this connection."],
  ["institution_inactive", 403, "The institution is suspended or closed."],
  ["idempotency_conflict", 409, "The Idempotency-Key was used with a different body, or that request is still running."],
  ["not_found", 404, "No such run for this key."],
  ["rate_limited", 429, "More than 120 roster requests in an hour for this connection."],
  ["unavailable", 503, "The service is being updated. Retry later with the same Idempotency-Key."],
  ["internal", 500, "Our fault. Retry with the same Idempotency-Key; quote the request_id if it keeps happening."],
];

// Public, so an institution's ICT team can read it before signing anything.
export default function Developers() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 text-sm leading-relaxed sm:px-6">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">UniAttend · Webbex Solutions (Pty) Ltd</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">Institution API, version 1</h1>
      <p className="mt-3 text-muted">For a university&apos;s own student system or middleware to send UniAttend its modules, students, lecturers and
        enrolments. UniAttend can also read rosters itself (Moodle, a scheduled CSV/JSON link) or take uploaded files; see
        Integrations in the admin area.</p>
      <nav className="mt-6 flex flex-wrap gap-x-4 gap-y-1 text-info">
        {[["auth", "Authentication"], ["roster", "Send a roster"], ["retries", "Retries"], ["status", "Status and runs"], ["errors", "Errors"],
          ["limits", "Limits"], ["safety", "How data is applied"], ["security", "Security"], ["versions", "Versioning"]].map(([id, l]) => (
          <a key={id} href={`#${id}`} className="hover:underline">{l}</a>
        ))}
      </nav>

      <H2 id="auth">Authentication</H2>
      <p className="mt-2">An institution administrator creates a key under <b>Integrations → Connect → Your system sends it (API)</b>. The key is shown
        once; UniAttend stores only its SHA-256 hash. Send it on every request:</p>
      <Code>{`Authorization: Bearer ua_<48 hex characters>`}</Code>
      <p className="mt-2">The key decides the institution and connection. Nothing in a request body can name another institution. A new key replaces the
        old one immediately (<b>New key</b> on the connection); pausing the connection or deleting it stops the key.</p>

      <H2 id="roster">Send a roster</H2>
      <Code>{`POST https://<your UniAttend address>/api/v1/roster
Authorization: Bearer ua_…
Content-Type: application/json
Idempotency-Key: sis-2026-11-15-0600

{
  "complete": true,
  "modules": [{ "code": "CSC1541", "title": "Introduction to Programming" }],
  "people": [
    { "role": "student",  "number": "22001234", "full_name": "Thandi Mokoena", "email": "22001234@univ.ac.za", "module_codes": ["CSC1541"] },
    { "role": "lecturer", "number": "L0042",    "full_name": "Dr S. Ndlovu",   "email": "s.ndlovu@univ.ac.za",  "module_codes": ["CSC1541"] }
  ]
}`}</Code>
      <p className="mt-2">CSV works too (<C>Content-Type: text/csv</C>, one row per person per module, header row:
        <C>role,number,full_name,email,module_code,module_title</C>; add <C>?complete=1</C> for a whole roster).</p>
      <p className="mt-2">Answer (200):</p>
      <Code>{`{
  "students_added": 1, "students_updated": 0, "lecturers_added": 0, "enrolments_added": 1, "assignments_added": 1,
  "skipped": 0, "unknown_modules": [], "errors": [],
  "run_id": "6f1c…", "complete": true, "enrolments_dropped": 0, "held_back": 0,
  "replayed": false, "request_id": "0b9e…"
}`}</Code>

      <H2 id="retries">Retries (Idempotency-Key)</H2>
      <p className="mt-2">Send an <C>Idempotency-Key</C> header (8–100 letters, digits or <C>. _ : -</C>) that is unique per roster you send. If the
        network fails and you send the same request again with the same key, UniAttend returns the first answer with <C>&quot;replayed&quot;: true</C> and
        applies nothing twice. The same key with a different body is refused (<C>409 idempotency_conflict</C>). Keys are remembered for 7 days per
        connection. Without the header every request is applied.</p>

      <H2 id="status">Status and runs</H2>
      <Code>{`GET /api/v1/status          → institution, connection, status, runs in the last hour, last 10 runs
GET /api/v1/runs/{run_id}   → one run: status, summary, error, rejected rows (first 200)`}</Code>
      <p className="mt-2">Both need the same <C>Authorization</C> header and only ever show the key&apos;s own connection. Use <C>/status</C> to test a new key.</p>

      <H2 id="errors">Errors</H2>
      <p className="mt-2">Every error has the same shape, and every answer carries an <C>X-Request-Id</C> header:</p>
      <Code>{`{ "error": { "code": "rate_limited", "message": "Too many requests. Send at most 120 rosters an hour." }, "request_id": "0b9e…" }`}</Code>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[520px] text-left">
          <thead><tr className="border-b border-line text-xs uppercase text-muted"><th className="py-2">Code</th><th>HTTP</th><th>Meaning</th></tr></thead>
          <tbody className="divide-y divide-line">
            {ERRORS.map(([c, s, m]) => <tr key={c}><td className="py-2 font-mono text-xs">{c}</td><td>{s}</td><td>{m}</td></tr>)}
          </tbody>
        </table>
      </div>

      <H2 id="limits">Limits</H2>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>120 roster requests per connection per hour.</li>
        <li>20 MB and 20,000 people per request. Larger rosters: send one request per faculty, with <C>&quot;complete&quot;: false</C>.</li>
        <li>A request must finish within 60 seconds.</li>
      </ul>

      <H2 id="safety">How data is applied</H2>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>Students are matched by student number, so a changed email or name updates the same student instead of creating a second one.
          Lecturers are matched by email first, then by staff number.</li>
        <li>Modules UniAttend does not know are listed in <C>unknown_modules</C> and skipped, unless the connection allows creating modules.</li>
        <li>Nothing is deleted because it is missing from a request. Only when you send <C>&quot;complete&quot;: true</C> and the connection allows it are
          enrolments this connection created, and that the roster no longer lists, marked <i>dropped</i>. Attendance history is always kept.</li>
        <li>If a complete roster would drop most students at once (or lists nobody), nothing is dropped and the count is reported in
          <C> held_back</C> for an administrator to check: a broken export looks like that far more often than a real change.</li>
        <li>Each request is applied in one transaction: it either all applies or nothing does.</li>
      </ul>

      <H2 id="security">Security</H2>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>HTTPS only. Keep the key in your system&apos;s secret store, not in code or logs. Replace it if it may have leaked.</li>
        <li>Every request is recorded as a run the institution&apos;s administrators can see under Integrations → Activity.</li>
        <li>UniAttend never calls back into your system through this API, and the key gives no access to attendance records.</li>
      </ul>

      <H2 id="versions">Versioning</H2>
      <p className="mt-2">Within <C>/api/v1</C>, fields may be added but are never removed or renamed, and error codes keep their meaning. A breaking
        change becomes <C>/api/v2</C>, announced at least six months before v1 is switched off. The older unversioned <C>/api/roster</C> still works and
        behaves like v1 without retries or the error shape above; new integrations should use v1.</p>

      <p className="mt-12 text-xs text-muted">Questions: your UniAttend contact. <Link href="/privacy" className="hover:underline">Privacy</Link> ·{" "}
        <Link href="/terms" className="hover:underline">Terms</Link></p>
    </main>
  );
}
