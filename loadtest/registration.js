// UniAttend registration load test (k6). STAGING ONLY.
//
// Scenarios (SCENARIO=...):
//   ramp     sign-ups at 100 → 500 → 1k → 5k → 10k VUs (each VU pauses THINK_S between sign-ups)
//   burst1k  1,000 sign-ups spread over 5 minutes (the registration-burst target)
//   auth_ip  T-AUTH: 60 password sign-ins of seeded users in 30 s from this one machine, to see
//            whether Supabase Auth's per-IP limit on /auth/v1/token (burst 30) applies.
//
// Sign-ups call Supabase Auth directly (POST /auth/v1/signup) with the same payload the app's
// signUp server action sends. Staging Auth MUST use a mail sink (Mailpit, Mailtrap…) as SMTP,
// or confirmations disabled, so no real email is sent. Remove the users afterwards with
// loadtest/seed/cleanup-staging.sql.
//
// Note: from one generator every request shares an IP, so Auth per-IP limits apply here
// exactly as they would to the app's Vercel egress IPs. Read 429s in that light (see README).
import http from "k6/http";
import exec from "k6/execution";
import { check, sleep } from "k6";
import { Counter, Rate } from "k6/metrics";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.2/index.js";
import { assertStaging, env, int, SUMMARY_STATS } from "./lib/config.js";
import { studentEmail } from "./lib/identity.js";
import { burstScenario, rampScenario } from "./lib/scenarios.js";

const SCENARIO = env("SCENARIO", "burst1k");
const SUPABASE_URL = env("SUPABASE_URL").replace(/\/$/, "");
const ANON_KEY = env("SUPABASE_ANON_KEY");
const REG_DOMAIN = env("REG_EMAIL_DOMAIN", "loadtest.example");
const EMAIL_DOMAIN = env("LOADTEST_EMAIL_DOMAIN", "loadtest.example");
const SEED_PASSWORD = SCENARIO === "auth_ip" ? env("SEED_PASSWORD") : "";
const SITE_URL = env("SITE_URL", "https://staging.invalid");
const THINK_S = parseFloat(env("THINK_S", "30"));
const RUN_ID = env("RUN_ID", String(Date.now()));

assertStaging([SUPABASE_URL, SITE_URL]);

const scenarios = {
  ramp: () => rampScenario("signUp"),
  burst1k: () => burstScenario("burst1k", "signUp", 1000, "5m"),
  auth_ip: () => ({ auth_ip: { executor: "constant-arrival-rate", exec: "signIn", rate: 2, timeUnit: "1s", duration: "30s", preAllocatedVUs: 20, maxVUs: 60 } }),
}[SCENARIO];
if (!scenarios) throw new Error("SCENARIO must be ramp, burst1k or auth_ip");

export const options = {
  scenarios: scenarios(),
  summaryTrendStats: SUMMARY_STATS,
  thresholds: {
    "http_req_duration{op:signup}": ["p(95)<500"],
    reg_errors: ["rate<0.01"],
  },
};

const errors = new Rate("reg_errors");
const created = new Counter("reg_created");
const limited = new Counter("auth_429");
const emailRefused = new Counter("reg_email_refused");
const signins = new Counter("auth_signin_ok");

const headers = { apikey: ANON_KEY, "Content-Type": "application/json" };

export function signUp() {
  const n = exec.scenario.iterationInTest;
  const email = `loadtest+reg-${RUN_ID}-${n}@${REG_DOMAIN}`;
  const res = http.post(`${SUPABASE_URL}/auth/v1/signup?redirect_to=${encodeURIComponent(SITE_URL + "/auth/callback")}`, JSON.stringify({
    email, password: `Lt-${RUN_ID}-${n}-pw!`,
    data: { full_name: `Load Test ${n}`, app: "uniattend" },
  }), { headers, tags: { op: "signup" }, timeout: "60s" });

  const ok = res.status === 200;
  errors.add(!ok);
  if (ok) created.add(1);
  if (res.status === 429) limited.add(1);
  // Auth answers 500 "Error sending confirmation email" when SMTP refuses or its hourly cap is hit.
  if (res.status >= 500 && /email/i.test(res.body || "")) emailRefused.add(1);
  check(res, { "signup 200": () => ok });
  if (SCENARIO === "ramp") sleep(THINK_S * (0.5 + Math.random()));
}

/** T-AUTH: password sign-ins of seeded students, 2 per second for 30 s. */
export function signIn() {
  const i = (exec.scenario.iterationInTest % int("N_STUDENTS", 10000)) + 1;
  const res = http.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, JSON.stringify({
    email: studentEmail(i, EMAIL_DOMAIN), password: SEED_PASSWORD,
  }), { headers, tags: { op: "signin" }, timeout: "30s" });
  if (res.status === 200) signins.add(1);
  if (res.status === 429) limited.add(1);
  errors.add(res.status !== 200);
}

export function handleSummary(data) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = `loadtest/results/registration-${SCENARIO}-${stamp}.json`;
  return { stdout: textSummary(data, { indent: "  ", enableColors: true }), [file]: JSON.stringify(data, null, 2) };
}
