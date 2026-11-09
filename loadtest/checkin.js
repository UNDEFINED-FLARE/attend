// UniAttend attendance check-in load test (k6). STAGING ONLY.
//
//   TARGET=rest  (default) calls uniattend.check_in() through PostgREST — the database path.
//   TARGET=app   posts the Next.js server action through Vercel — middleware, Auth getUser,
//                server action, RPC and venue lookup: the path a phone actually takes.
//
// Scenarios (SCENARIO=...): ramp | burst5k | burst10k
//
// Requires the staging seed (loadtest/seed/seed-staging.sql) and its parameters:
// N_STUDENTS, N_SESSIONS, QR_SECRET_HEX, VENUE_LAT, VENUE_LNG must match the seed.
// Run loadtest/sql/reset-run.sql between runs, and loadtest/sql/validate-checkins.sql after each run.
import http from "k6/http";
import exec from "k6/execution";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.2/index.js";
import { assertStaging, env, int, supabaseRef, SUMMARY_STATS, vercelHeaders } from "./lib/config.js";
import { authCookie, deviceHash, gpsSamples, mintJwt, qrToken, sessionId, sessionOfStudent, studentEmail, studentUserId } from "./lib/identity.js";
import { burstScenario, rampScenario } from "./lib/scenarios.js";

// ---------------------------------------------------------------- config
const TARGET = env("TARGET", "rest");
const SCENARIO = env("SCENARIO", "burst5k");
const SUPABASE_URL = env("SUPABASE_URL").replace(/\/$/, "");
const ANON_KEY = env("SUPABASE_ANON_KEY");
const JWT_SECRET = env("STAGING_JWT_SECRET");
const BASE_URL = TARGET === "app" ? env("BASE_URL").replace(/\/$/, "") : "";
const ACTION_ID = TARGET === "app" ? env("NEXT_ACTION_ID_CHECKIN") : "";
const N_STUDENTS = int("N_STUDENTS", 10000);
const N_SESSIONS = int("N_SESSIONS", 20);
const QR_SECRET_HEX = env("QR_SECRET_HEX");
const VENUE_LAT = parseFloat(env("VENUE_LAT", "-25.7545"));
const VENUE_LNG = parseFloat(env("VENUE_LNG", "28.2314"));
const EMAIL_DOMAIN = env("LOADTEST_EMAIL_DOMAIN", "loadtest.example");
const DUP_RATE = parseFloat(env("DUP_RATE", "0.02"));   // share of check-ins sent twice at the same instant
const THINK_S = parseFloat(env("THINK_S", "5"));       // ramp only: pause between a VU's check-ins
const TOKEN_TTL = 4 * 3600;

assertStaging([SUPABASE_URL, BASE_URL]);
if (!["rest", "app"].includes(TARGET)) throw new Error("TARGET must be rest or app");

const scenarios = {
  ramp: () => rampScenario("checkIn"),
  burst5k: () => burstScenario("burst5k", "checkIn", 5000, "60s"),
  burst10k: () => burstScenario("burst10k", "checkIn", 10000, "60s"),
}[SCENARIO];
if (!scenarios) throw new Error("SCENARIO must be ramp, burst5k or burst10k");

export const options = {
  scenarios: scenarios(),
  summaryTrendStats: SUMMARY_STATS,
  discardResponseBodies: false,
  thresholds: {
    // Targets from the capacity plan. A failed threshold marks the run as failed; it is the result, not an error.
    "http_req_duration{op:check_in}": ["p(95)<1000"],
    checkin_errors: ["rate<0.01"],
    checkin_unexpected_duplicate: ["count==0"],
  },
};

// ---------------------------------------------------------------- metrics
const outcomes = {
  accepted: new Counter("checkin_accepted"),
  review: new Counter("checkin_review"),
  rejected: new Counter("checkin_rejected"),
  duplicate: new Counter("checkin_duplicate"),
};
const errors = new Rate("checkin_errors");
const rateLimited = new Counter("checkin_rate_limited");
const expectedDup = new Counter("checkin_expected_duplicate");   // second attempt for a student, by design
const unexpectedDup = new Counter("checkin_unexpected_duplicate"); // both racing requests reported "accepted" (D-2)
const lateStatus = new Counter("checkin_late_pending");
const latency = new Trend("checkin_latency", true);

// ---------------------------------------------------------------- request builders
function restRequest(i) {
  const uid = studentUserId(i);
  const session = sessionId(sessionOfStudent(i, N_SESSIONS));
  const jwt = mintJwt(JWT_SECRET, uid, studentEmail(i, EMAIL_DOMAIN), TOKEN_TTL);
  return {
    method: "POST",
    url: `${SUPABASE_URL}/rest/v1/rpc/check_in`,
    body: JSON.stringify({
      p_session: session, p_code: null, p_token: qrToken(QR_SECRET_HEX, session),
      p_gps: { samples: gpsSamples(VENUE_LAT, VENUE_LNG) }, p_device_hash: deviceHash(i),
    }),
    params: {
      headers: {
        apikey: ANON_KEY, Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json", "Content-Profile": "uniattend", "Accept-Profile": "uniattend",
      },
      tags: { op: "check_in", target: "rest" }, timeout: "60s",
    },
  };
}

function appRequest(i) {
  const uid = studentUserId(i);
  const email = studentEmail(i, EMAIL_DOMAIN);
  const session = sessionId(sessionOfStudent(i, N_SESSIONS));
  const jwt = mintJwt(JWT_SECRET, uid, email, TOKEN_TTL);
  const arg = {
    session, code: null, token: qrToken(QR_SECRET_HEX, session),
    gps: { samples: gpsSamples(VENUE_LAT, VENUE_LNG) }, device: deviceHash(i),
  };
  return {
    method: "POST",
    url: `${BASE_URL}/student/check-in`,
    body: JSON.stringify([arg]),
    params: {
      headers: {
        ...vercelHeaders(),
        "Next-Action": ACTION_ID, Accept: "text/x-component", "Content-Type": "text/plain;charset=UTF-8",
        Origin: BASE_URL, Cookie: authCookie(supabaseRef(SUPABASE_URL), jwt, uid, email, TOKEN_TTL),
      },
      tags: { op: "check_in", target: "app" }, timeout: "60s", redirects: 0,
    },
  };
}

function classify(res) {
  if (res.status === 0) return { error: `network: ${res.error}` };
  const body = res.body || "";
  if (TARGET === "rest") {
    if (res.status === 200) {
      try { return JSON.parse(body); } catch (e) { return { error: `bad json: ${e}` }; }
    }
    return { error: `${res.status}: ${body.slice(0, 160)}` };
  }
  // Server action: an RSC flight payload. The verdict is a JSON object inside it.
  if (res.status !== 200) return { error: `${res.status}${res.status === 307 || res.status === 302 ? " (redirected: not signed in? check staging Auth/JWT secret)" : ""}` };
  const outcome = /"outcome":"(accepted|review|rejected|duplicate)"/.exec(body);
  const status = /"status":"([a-z_]+)"/.exec(body);
  if (outcome) return { outcome: outcome[1], status: status ? status[1] : null };
  const err = /"error":"([^"]{0,160})"/.exec(body);
  return { error: err ? `action error: ${err[1]}` : "no verdict in action response" };
}

function record(res, verdict) {
  latency.add(res.timings.duration);
  const failed = !!verdict.error;
  errors.add(failed);
  if (failed) {
    if (/Too many attempts/.test(verdict.error)) rateLimited.add(1);
    return;
  }
  if (outcomes[verdict.outcome]) outcomes[verdict.outcome].add(1);
  if (verdict.status === "late_pending") lateStatus.add(1);
}

let authFailures = 0;

// ---------------------------------------------------------------- the test
export function checkIn() {
  const iter = exec.scenario.iterationInTest;
  const i = (iter % N_STUDENTS) + 1;
  if (iter >= N_STUDENTS) expectedDup.add(1); // more iterations than students: repeat attempts by design

  const build = TARGET === "app" ? appRequest : restRequest;
  const racing = Math.random() < DUP_RATE;
  const reqs = racing ? [build(i), build(i)] : [build(i)];
  const responses = http.batch(reqs);

  const verdicts = responses.map(classify);
  responses.forEach((r, n) => record(r, verdicts[n]));
  check(verdicts[0], { "check-in got a verdict": (v) => !v.error });

  if (racing) {
    const accepted = verdicts.filter((v) => v.outcome === "accepted").length;
    if (accepted > 1) unexpectedDup.add(1);
  }

  // Abort quickly if the target does not know the seeded staging users (wrong project, wrong JWT
  // secret, seed not run, or an app deployment wired to a different Supabase project).
  if (verdicts.some((v) => v.error && /redirected|not registered|JWT|PGRST30|401/.test(v.error))) {
    authFailures++;
    if (authFailures >= 5) {
      exec.test.abort(`Seeded users are rejected (${verdicts[0].error}). Check SUPABASE_URL/BASE_URL point at the seeded staging project.`);
    }
  }

  if (SCENARIO === "ramp") sleep(THINK_S * (0.5 + Math.random()));
}

export function handleSummary(data) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = `loadtest/results/checkin-${TARGET}-${SCENARIO}-${stamp}.json`;
  return { stdout: textSummary(data, { indent: "  ", enableColors: true }), [file]: JSON.stringify(data, null, 2) };
}
