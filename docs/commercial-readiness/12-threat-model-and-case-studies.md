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
- Confirmed, by test and by Supabase's Security Advisor, that the RLS epidemic behind the vibe-coded
  breaches does not apply here.

## E. Still open (owner, in priority order)

1. **Enable leaked-password protection** (U1) — one toggle, highest value.
2. **Set the Turnstile keys** (U3) and turn on error/job alerting (U4).
3. **Enforce MFA for admins** (U2) — a build item.
4. **Dedicated Supabase project with backups and a restore drill** (U6, and `03`/`06`).
5. Independent penetration test before any paid contract (`03`).

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
