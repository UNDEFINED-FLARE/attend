import "server-only";
import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { sendNotification, setVapidDetails, WebPushError } from "web-push";
import { DB_SCHEMA, env } from "@/lib/env";

// Delivers queued notifications to phones and browsers with Web Push.
// The database decides what is due (push_claim); this only encrypts and sends.
// Needs NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT and
// PUSH_DISPATCH_SECRET (the same secret given to set_push_secret()).

export const pushConfigured = () =>
  !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.PUSH_DISPATCH_SECRET);

export function secretMatches(given: string | null | undefined) {
  const want = process.env.PUSH_DISPATCH_SECRET ?? "";
  const a = Buffer.from(given ?? ""), b = Buffer.from(want);
  return want.length >= 32 && a.length === b.length && timingSafeEqual(a, b);
}

type Claimed = { notification_id: string; kind: string; title: string; body: string | null; link: string | null;
  institution_name: string | null; logo_url: string | null; endpoint: string; p256dh: string; auth: string };

/** What the service worker receives. */
export type PushPayload = { id: string; kind: string; title: string; body: string; url: string; icon: string;
  badge: string; institution: string | null };

const URGENT = new Set(["class_reminder", "session_open"]);

export async function dispatchPush(): Promise<{ sent: number; gone: number; failed: number }> {
  if (!pushConfigured()) return { sent: 0, gone: 0, failed: 0 };
  setVapidDetails(process.env.VAPID_SUBJECT || `mailto:support@${new URL(env.siteUrl).hostname}`,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  const secret = process.env.PUSH_DISPATCH_SECRET!;
  const db = createClient(env.url, env.anonKey, { db: { schema: DB_SCHEMA }, auth: { persistSession: false, autoRefreshToken: false } });

  const { data, error } = await db.rpc("push_claim", { p_secret: secret, p_limit: 500 });
  if (error) throw new Error(`push_claim: ${error.message}`);
  const rows = (data ?? []) as Claimed[];
  const sentTo: string[] = [], gone: string[] = [];
  let failed = 0;

  const queue = [...rows];
  await Promise.all(Array.from({ length: Math.min(20, queue.length) }, async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      const payload: PushPayload = {
        id: r.notification_id, kind: r.kind, title: r.title, body: r.body ?? "",
        url: r.link && r.link.startsWith("/") ? r.link : "/notifications",
        icon: r.logo_url ?? "/icons/icon-192.png", badge: "/icons/badge-96.png", institution: r.institution_name,
      };
      try {
        await sendNotification({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, JSON.stringify(payload), {
          TTL: r.kind === "class_reminder" ? 20 * 60 : r.kind === "session_open" ? 15 * 60 : 24 * 3600,
          urgency: URGENT.has(r.kind) ? "high" : "normal",
          topic: r.kind === "class_reminder" ? undefined : r.notification_id.replace(/-/g, "").slice(0, 32),
          timeout: 10_000,
        });
        sentTo.push(r.endpoint);
      } catch (e) {
        if (e instanceof WebPushError && (e.statusCode === 404 || e.statusCode === 410)) gone.push(r.endpoint);
        else failed++;
      }
    }
  }));

  await Promise.all([
    ...[...new Set(gone)].map((endpoint) => db.rpc("push_forget", { p_secret: secret, p_endpoint: endpoint })),
    sentTo.length ? db.rpc("push_sent", { p_secret: secret, p_endpoints: [...new Set(sentTo)] }) : Promise.resolve(),
  ]);
  return { sent: sentTo.length, gone: gone.length, failed };
}

/** Send right away after an action that created notifications; errors never reach the user. */
export async function kickPush() {
  try { await dispatchPush(); } catch (e) { console.error("push dispatch failed", e); }
}
