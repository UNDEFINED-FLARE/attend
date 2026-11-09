// Deterministic identities shared with loadtest/seed/seed-staging.sql, JWT
// minting for seeded users, the @supabase/ssr auth cookie, and QR tokens.
import crypto from "k6/crypto";
import encoding from "k6/encoding";

/** Same as Postgres md5(text)::uuid. */
export function md5uuid(text) {
  const h = crypto.md5(text, "hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export const studentUserId = (i) => md5uuid(`loadtest-student-${i}`);
export const sessionId = (k) => md5uuid(`loadtest-session-${k}`);
export const lecturerUserId = () => md5uuid("loadtest-lecturer");
export const studentEmail = (i, domain) => `loadtest+s${i}@${domain}`;

/** Student i (1-based) is enrolled in module/session ((i-1) % nSessions) + 1 — see the seed. */
export const sessionOfStudent = (i, nSessions) => ((i - 1) % nSessions) + 1;

/**
 * A Supabase access token for a seeded user, signed with the STAGING project's
 * legacy HS256 JWT secret. This skips Supabase Auth on purpose so the check-in
 * test measures the database path, not the Auth rate limits (T-AUTH covers those).
 */
export function mintJwt(secret, userId, email, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const header = encoding.b64encode(JSON.stringify({ alg: "HS256", typ: "JWT" }), "rawurl");
  const payload = encoding.b64encode(JSON.stringify({
    sub: userId, email, role: "authenticated", aud: "authenticated",
    iat: now - 30, exp: now + ttlSeconds, session_id: md5uuid(`loadtest-jwt-${userId}`), is_anonymous: false,
  }), "rawurl");
  const sig = crypto.hmac("sha256", secret, `${header}.${payload}`, "base64rawurl");
  return `${header}.${payload}.${sig}`;
}

/**
 * The cookie @supabase/ssr reads: sb-<ref>-auth-token = "base64-" + base64url(session JSON),
 * split into .0/.1/... chunks above 3180 characters.
 */
export function authCookie(ref, accessToken, userId, email, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const session = {
    access_token: accessToken, token_type: "bearer", expires_in: ttlSeconds, expires_at: now + ttlSeconds,
    refresh_token: "loadtest-no-refresh",
    user: { id: userId, aud: "authenticated", role: "authenticated", email, app_metadata: { provider: "email" }, user_metadata: { app: "uniattend" } },
  };
  const value = "base64-" + encoding.b64encode(JSON.stringify(session), "rawurl");
  const name = `sb-${ref}-auth-token`;
  const MAX = 3180;
  if (value.length <= MAX) return `${name}=${value}`;
  const parts = [];
  for (let i = 0, n = 0; i < value.length; i += MAX, n++) parts.push(`${name}.${n}=${value.slice(i, i + MAX)}`);
  return parts.join("; ");
}

function hexToBuffer(hex) {
  const clean = hex.replace(/^\\x/, "");
  if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length % 2) throw new Error("QR_SECRET_HEX must be hex");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out.buffer;
}

/**
 * Same token uniattend.qr_sign() makes: step "." + first 22 chars of base64(HMAC-SHA256(secret, "<session>:<step>"))
 * with + and / mapped to - and _. Uses a step 2 s in the past so a generator clock slightly ahead of the
 * database is still inside the accepted [now-1, now] window.
 */
export function qrToken(secretHex, session) {
  const step = Math.floor((Date.now() - 2000) / 20000);
  const b64 = crypto.hmac("sha256", hexToBuffer(secretHex), `${session}:${step}`, "base64");
  return `${step}.${b64.slice(0, 22).replace(/\+/g, "-").replace(/\//g, "_")}`;
}

/** Four GPS samples inside the venue radius with varied accuracy (uniform readings are penalised as spoofing). */
export function gpsSamples(lat, lng) {
  const samples = [];
  for (let i = 0; i < 4; i++) {
    samples.push({
      lat: lat + (Math.random() - 0.5) * 0.0001,
      lng: lng + (Math.random() - 0.5) * 0.0001,
      accuracy: 8 + Math.round(Math.random() * 20 * 10) / 10,
    });
  }
  return samples;
}

export const deviceHash = (i) => crypto.sha256(`loadtest-device-${i}`, "hex");
