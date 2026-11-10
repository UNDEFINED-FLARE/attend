// Where to send someone after sign-in or an email link. Only paths on this
// site are allowed. A plain "starts with / but not //" check is not enough:
// browsers treat "\" like "/" and strip tabs/newlines, so "/\evil.com" or
// "/\t/evil.com" would leave the site. We reject those characters outright and
// then confirm the resolved URL is still on our own origin.
const BASE = "http://uniattend.invalid";

export function safeNextPath(raw: unknown, fallback = "/dashboard"): string {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return fallback;
  try {
    const url = new URL(raw, BASE);
    if (url.origin !== BASE) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
