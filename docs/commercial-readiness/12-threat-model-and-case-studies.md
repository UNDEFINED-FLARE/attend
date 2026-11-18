# 12 — Threat model from real breaches

*18 November 2026. This reviews UniAttend against two sets of real-world incidents: 2025–2026
breaches of apps built quickly with AI coding tools ("vibe coding"), and recent university
breaches. For each class of attack it gives an honest verdict: handled in code, an owner action, or
a recommendation. It is an internal review, not an independent penetration test — see
[03-security-review.md](03-security-review.md).*

## How this was tested

For each case study the matching weakness was checked against UniAttend: the migrations and policies,
the server code, and the live test project through Supabase's own **Security Advisor** (the check the
case studies say every Supabase app must run). A new automated test, `tests/db/rls-coverage.test.ts`,
now proves the most important guarantees against **all** migrations on every run, so a future change
can't quietly reintroduce them.

## A. AI-built app breaches (vibe coding)

The dominant failure, across CVE-2025-48757 (170+ Lovable apps) and the Moltbook leak (1.5 million
tokens), is **Row Level Security (RLS) left off or left too open**, followed by **secret keys shipped
in the browser** and **server-side request forgery (SSRF)**.

| # | What went wrong in the wild | UniAttend | Evidence |
|---|---|---|---|
| V1 | A table shipped with **RLS off** → anyone with the public key reads/writes it | **Handled.** RLS is enabled by a loop over every table (migration 0004) and re-enabled in every later migration. A test now fails if any `uniattend` table has RLS off. | `…0004_rls.sql`; `tests/db/rls-coverage.test.ts` |
| V2 | A policy that only checks "is logged in", not "owns the row" (`USING (true)`) | **Handled.** No permissive `USING (true)` / `WITH CHECK (true)` policy exists on any tenant table. Every tenant row carries `institution_id`; cross-institution access is tested. | grep of migrations; `tests/db/platform.test.ts` |
| V3 | **Service-role key in client-side JavaScript** (bypasses RLS) | **Handled.** The service-role key is never used by the web app and never set in Vercel. The only public vars are the anon key, site URL, and the Turnstile and VAPID **public** keys. | `grep NEXT_PUBLIC_`; README |
| V4 | Secrets readable in the bundle (API keys, tokens) | **Handled.** `INTEGRATION_ENCRYPTION_KEY`, `VAPID_PRIVATE_KEY`, `PUSH_DISPATCH_SECRET` and the Paystack key are read only in server-only files; integration credentials are encrypted (AES-256-GCM) before storage. | `src/lib/integrations/secrets.ts`, `src/lib/push.ts` |
| V5 | **`user_metadata` trusted for authorization** (it is set by the client at sign-up) | **Handled.** Sign-up metadata only decides whether to create a *profile* row (which a user gets anyway); it never grants a role. Roles are granted by admins only, and that is tested. | `handle_new_user()` in `…0005_functions.sql`; `tests/db/security.test.ts` |
| V6 | Tables meant to be unreadable (secrets) left readable | **Handled.** The QR signing key, dispatch secret, integration secrets and API-request log are deny-all (RLS on, no policy). The test confirms a signed-in user and an anonymous client read **zero** rows even when rows exist. | `tests/db/rls-coverage.test.ts` |
| V7 | **SSRF**: the server fetches a user-supplied URL and reaches internal addresses | **Handled.** Every outbound fetch of an admin-supplied URL (Moodle, roster feed, REST connector) goes through `assertPublicHttps`: https only, no credentials in the URL, private/internal addresses refused by name and after DNS, re-checked on each redirect, with time and size caps. Map and route calls go to fixed, public hosts. | `src/lib/url-safety.ts`, `src/lib/integrations/sources.ts`; `tests/unit/url-safety.test.ts` |
| V8 | Tested only in the SQL editor (which bypasses RLS), so holes go unseen | **Handled.** The database tests run as the `authenticated` and `anon` roles with a real JWT subject — the same path as the public key — not as the owner. | `tests/db/harness.ts` |
| V9 | No script policy → injected markup runs and calls the backend | **Handled (this branch).** A Content Security Policy with a per-request nonce means only the app's own scripts run. Inside the Android app this also stops injected markup reaching the phone's native bridge. | `src/lib/csp.ts`, `src/middleware.ts` |

**Advisor result (live test project, 18 Nov 2026):** no missing-RLS findings. Three `rls_enabled_no_policy`
notices — all on the deny-all tables above, which is the intended design. The 50 "signed-in users can
execute a SECURITY DEFINER function" warnings are by design: privileged work is done in such functions,
each of which checks the caller's role and institution at the top (tested). One real finding, below.

## A2. API keys — theft, forgery and injection

"If someone takes or forges an API key, can they get the data?" Tested in `tests/db/api-keys.test.ts`.

- **The public (anon) key** is in the browser by design. It is not a secret; RLS is the control, and a
  signed-out client holding only it reads no tenant data (proven in `rls-coverage.test.ts`). Taking it
  gains nothing.
- **An institution API key** (`ua_` + 48 hex = 192 random bits) lets a university's own system push its
  roster. A stolen or forged one has a small blast radius: it is **rejected unless it matches** (keys are
  stored only as a SHA-256 hash, so a database leak reveals no usable key, and guessing 192 bits is
  infeasible); it reaches **only its own institution** (the key decides the institution — nothing in the
  request body can); it **cannot read another connection's data even with the run id** (no IDOR); it
  **cannot read attendance**; it is **rate-limited** to 120 pushes an hour; and it can be **rotated**,
  which kills the old key at once (incident response). The worst case is corrupting or reading back one
  institution's own roster import, not a cross-tenant breach.
- **SQL injection through a key or any parameter:** not possible. Every privileged function takes typed
  parameters bound by the driver; the only dynamic SQL (`execute format(...)`) builds statements from
  catalog identifiers (function and table names), never from user input. Verified across all migrations.
- **The service-role key** (which would bypass everything) is never in the client or in Vercel (V3).

## A3. Denial of service: volumetric, zip bombs and oversized payloads

| Attack | UniAttend | Evidence |
|---|---|---|
| **Decompression ("zip") bomb** — a tiny .xlsx/.docx (both are ZIP) that inflates to gigabytes | **Handled.** The unzip reader caps entries (5,000) and total inflated size (40 MB), and inflates with Node's `maxOutputLength`, which aborts a bomb mid-decompression. Uploads are capped at 5 MB first. | `src/lib/zip.ts`; `tests/unit/zip-bomb.test.ts` |
| **Oversized upload** exhausting memory | **Handled.** Server-action body limit 6 MB; CSV/roster/timetable uploads capped at 5 MB; logo 512 KB (checked by file signature). | `next.config.ts`, the import actions |
| **Huge bulk payload** to an RPC | **Handled.** import ≤ 10,000 rows, roster ≤ 20,000 people/modules (and > 50 needs the paid plan), register ≤ 3,000 entries, check-in ≤ 20 GPS samples, exports ≤ 200,000 rows. | migrations; `src/app/admin/**` |
| **Malicious PDF** (parser bomb) | **Handled.** 5 MB cap, at most 20 pages, fonts disabled. | `src/lib/timetable-pdf.ts` |
| **Request floods** at one feature | **Partly handled in app.** Check-in 5/min per student, class messages 20/hour, roster 120/hour; CAPTCHA at sign-in once keys are set. | migrations; `03` S7 |
| **Volumetric DDoS** (raw traffic flood) | **Owner/infra action.** This is not something app code can stop. Turn on Vercel's WAF / attack-challenge mode (or put Cloudflare in front), and keep Supabase on a plan whose connection pooler absorbs bursts. | **To do** (see E) |

## B. University breaches

Across the 2025–2026 cases (UPenn, Technical University of Denmark, Instructure Canvas, Nebraska), the
way in was almost always **stolen or weak credentials** — a VPN login, a support account, a user
account — not a broken application. Remediation recurs as: reset credentials, **enforce MFA**, patch,
and reconstruct the intrusion from **logs**.

| # | Lesson | UniAttend | Action |
|---|---|---|---|
| U1 | Weak/breached passwords are the main entry | Supabase can block passwords found in known breaches (HaveIBeenPwned). **It is currently OFF.** | **Owner action — do this first.** Supabase → Authentication → Policies → enable leaked-password protection, on the production project and the test project. |
| U2 | Accounts without MFA are taken over | UniAttend relies on Supabase email/password; **MFA is not enforced**, especially for admins and super-admins. | **Recommendation.** Turn on TOTP MFA in Supabase and require it for `institution_admin` and `super_admin`. A build item, not just config. |
| U3 | Automated credential-stuffing at the login page | Cloudflare Turnstile (CAPTCHA) is wired and activates once keys are set; Supabase applies its own auth rate limits. | **Owner action.** Set the Turnstile keys (`03-security-review.md` S7). |
| U4 | Breaches reconstructed from logs | An append-only audit log records role changes, corrections, review decisions, exports, imports and support access. No app role can edit or delete it. | **Keep.** Add an error tracker and an alert when a background job fails (`03` S6). |
| U5 | A support/vendor account held too much access | UniAttend staff see no institution data without a time-limited, audited support-access grant from the institution. | **Keep.** |
| U6 | Lateral movement from a shared system | The production database is still shared with other apps. One weakness next door sits beside university data. | **Owner action.** Move UniAttend to its own Supabase project (`03` S2). |

## C. "VPN and servers"

UniAttend is a web app on Vercel with a Supabase database; there is no VPN or self-managed server to
harden. The equivalent controls:

- **Transport:** HTTPS only, HSTS with preload; the Android app refuses plain http and trusts only
  Android's built-in certificate authorities, so a proxy on the phone can't read traffic
  (`next.config.ts`, `android/app/src/main/res/xml/network_security_config.xml`).
- **The "server" (Vercel):** no powered-by header, security headers on every route, the service-role
  key never set there, and all privileged work done in the database behind permission checks.
- **The database (Supabase):** RLS on every table; secrets in deny-all tables; outbound worker traffic
  proven with a hashed shared secret; point-in-time backups and a restore drill still outstanding
  (`06-production-readiness.md`).
- **If a private network is ever needed** (for example a university that will only expose its student
  system inside its own network), the REST/feed connector would run from a fixed-IP egress or a small
  connector the university hosts, rather than opening its network to Vercel. Not required for the pilot.

## D. What changed in this review

- Added `tests/db/rls-coverage.test.ts`: every table has RLS on; the secret tables are deny-all and
  return nothing to a signed-in or anonymous client; anon reads no tenant data.
- Added `tests/db/api-keys.test.ts`: a forged key is refused; a stolen key reaches only its own
  institution, cannot read another connection's run, and cannot read attendance; a leaked key can be
  rotated to kill it.
- Added `tests/unit/zip-bomb.test.ts`: the unzip reader refuses a decompression bomb and an archive
  claiming too many files.
- Confirmed, by test and by Supabase's Security Advisor, that the RLS epidemic behind the vibe-coded
  breaches does not apply here, that a stolen/forged key has a small blast radius, and that uploads and
  bulk payloads are bounded against resource-exhaustion attacks.

## E. Still open (owner, in priority order)

1. **Enable leaked-password protection** (U1) — one toggle, highest value.
2. **Set the Turnstile keys** (U3) and turn on error/job alerting (U4).
3. **Enforce MFA for admins** (U2) — a build item.
4. **Turn on Vercel's WAF / attack-challenge mode** (or Cloudflare in front) for volumetric DDoS — app
   code cannot stop a raw traffic flood (A3).
5. **Dedicated Supabase project with backups and a restore drill** (U6, and `03`/`06`).
6. Independent penetration test before any paid contract (`03`).

## Sources

Figures below come mostly from security vendors and secondary write-ups; treat them as indicative, and
check the CVE record and the Wiz/UpGuard reports for primary detail.

- [OX Security — Vibe Coding Security: why a large share of AI-generated code ships with vulnerabilities](https://www.ox.security/blog/vibe-coding-security/)
- [UpGuard — Systemic data exposure in Supabase apps](https://www.upguard.com/blog/everything-everywhere-systemic-data-exposure-in-supabase-apps)
- [The Next Web — Lovable vibe-coding security crisis (CVE-2025-48757)](https://thenextweb.com/news/lovable-vibe-coding-security-crisis-exposed)
- [CursorGuard — 170 Lovable apps leaked user data: the RLS misconfiguration epidemic](https://cursorguard.com/blog/170-lovable-apps-breach/)
- [TechRadar — Moltbook AI social network left credentials unsecured](https://www.techradar.com/pro/security/ai-agent-social-media-network-moltbook-is-a-security-disaster-millions-of-credentials-and-other-details-left-unsecured)
- [Warin.io — Supabase security mistakes that expose vibe-coded apps](https://www.warin.io/blog/supabase-security-mistakes-vibe-coded-apps/)
- [FireCompass — University of Pennsylvania breach (compromised VPN credentials)](https://firecompass.com/university-of-pennsylvania-data-breach/)
- [ConnectWise — The Canvas / Instructure incident of 2026](https://www.connectwise.com/blog/the-canvas-cyber-incident-of-2026)
- [Dark Reading — Lessons in campus cybersecurity (Nebraska)](https://www.darkreading.com/cyberattacks-data-breaches/lessons-in-campus-cybersecurity)
- [Nametag — What higher-ed tech breaches reveal about student identity security](https://getnametag.com/newsroom/higher-ed-tech-breaches-student-identity-security)
