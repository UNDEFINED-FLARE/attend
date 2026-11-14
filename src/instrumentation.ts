// Server errors, sent to a chat channel so someone hears about them.
//
// Set ALERT_WEBHOOK_URL (Vercel → Settings → Environment Variables) to an incoming
// webhook: Slack, Discord, Microsoft Teams or Google Chat. Without it, errors only
// go to the Vercel logs as before. Messages carry the page, the error and its digest,
// never cookies, form contents or request bodies. The same error is sent at most
// once per 10 minutes per server instance, so an outage doesn't flood the channel.

const sent = new Map<string, number>();
const QUIET_MS = 10 * 60_000;

export async function register() { /* nothing to set up */ }

export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  const url = (process.env.ALERT_WEBHOOK_URL ?? "").trim();
  if (!url.startsWith("https://")) return;
  const e = error as Error & { digest?: string };
  const message = String(e?.message ?? error).replace(/\s+/g, " ").slice(0, 300);
  const key = `${context.routePath}|${message}`;
  const now = Date.now();
  if ((sent.get(key) ?? 0) > now - QUIET_MS) return;
  sent.set(key, now);
  if (sent.size > 500) sent.clear();

  const env = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown";
  const text = `UniAttend error (${env}) on ${request.method} ${context.routePath} [${context.routeType}]\n${message}${e?.digest ? `\ndigest: ${e.digest}` : ""}`;
  try {
    // "text" for Slack/Teams/Google Chat, "content" for Discord.
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, content: text }),
      signal: AbortSignal.timeout(3000) });
  } catch { /* alerting must never break a request */ }
}
