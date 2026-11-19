// Content Security Policy, set on every page by the middleware with a fresh nonce per request.
//
// Scripts run only if they carry this request's nonce, or were loaded by a script that does
// ('strict-dynamic': Next.js's own chunks, Cloudflare Turnstile). So markup that somehow got
// into a page can't run code. This matters most inside the Android app, where a page can reach
// the phone's native features (notifications, fingerprint unlock) through Capacitor.
//
// The other directives limit where the page may connect, what may frame it and where forms go
// (this site, or https for sign-in by institution).
// Hosts the browser talks to directly: the Supabase project (API and realtime), Overpass (building
// outlines on maps), Nominatim (campus search in the admin map editor), Cloudflare Turnstile. Map
// tiles and institution logos are images from many https hosts, so img-src allows https.
//
// CSP_MODE: "enforce" (default in production), "report-only" (log violations in the browser
// console without blocking; an emergency switch if something breaks), "off". In development the
// default is "off" because the dev server needs eval and its own websocket.

export type CspMode = "enforce" | "report-only" | "off";

export function cspMode(value: string | undefined, production: boolean): CspMode {
  if (value === "enforce" || value === "report-only" || value === "off") return value;
  return production ? "enforce" : "off";
}

/** The response header that carries the policy in this mode. */
export const cspHeaderName = (mode: CspMode) => (mode === "report-only" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy");

/** 128 random bits, base64. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/**
 * `upgrade`: add upgrade-insecure-requests. Only for pages served over https: on a plain-http test
 * server (localhost, or the Android emulator's 10.0.2.2) it would turn the page's own requests
 * into https ones that fail.
 */
export function buildCsp({ nonce, supabaseUrl, dev = false, upgrade = !dev }: { nonce: string; supabaseUrl?: string; dev?: boolean; upgrade?: boolean }): string {
  let supabase: string[] = [];
  try {
    if (supabaseUrl) {
      const u = new URL(supabaseUrl);
      supabase = [u.origin, `${u.protocol === "http:" ? "ws" : "wss"}://${u.host}`];
    }
  } catch { /* a malformed URL leaves Supabase out; the app would not work anyway */ }

  const turnstile = "https://challenges.cloudflare.com";
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", turnstile, ...(dev ? ["'unsafe-eval'"] : [])]],
    // Inline style attributes (theme colours, maps) can't carry a nonce.
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", "https:"]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", ["'self'", ...supabase, "https://overpass-api.de", "https://nominatim.openstreetmap.org", turnstile, ...(dev ? ["ws:", "wss:"] : [])]],
    ["frame-src", [turnstile]],
    // The service worker (sw.js) and any worker a library starts from a blob.
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["media-src", ["'self'", "blob:"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    // Sign-in by institution posts a form whose answer redirects to Supabase and then to the
    // institution's own identity provider (any host), so form targets may be any https address.
    ["form-action", ["'self'", "https:"]],
    ["frame-ancestors", ["'none'"]],
  ];
  const policy = directives.map(([k, v]) => `${k} ${v.join(" ")}`);
  if (upgrade) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}
