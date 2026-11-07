// Paystack webhook → payments + subscription renewal.
//
// Trust chain: (1) HMAC-SHA512 signature over the raw body with our secret key,
// (2) independent re-verification of the reference against Paystack's API,
// (3) amount and currency must match the plan price configured by the super
// admin. Only then is the subscription extended. A browser "payment succeeded"
// redirect never reaches this code path.
//
// Deploy:  supabase functions deploy paystack-webhook --no-verify-jwt
// Secrets: supabase secrets set PAYSTACK_SECRET_KEY=sk_live_...
// Paystack dashboard → Settings → API Keys & Webhooks → webhook URL:
//   https://<project-ref>.functions.supabase.co/paystack-webhook
//
// The checkout must set metadata { institution_id, plan_code } on the transaction.
import { createClient } from "jsr:@supabase/supabase-js@2";

const SECRET = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

async function hmacSha512Hex(key: string, body: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!SECRET) return new Response("not configured", { status: 503 });

  const raw = await req.text();
  const expected = await hmacSha512Hex(SECRET, raw);
  if (!timingSafeEqual(expected, req.headers.get("x-paystack-signature") ?? "")) {
    return new Response("bad signature", { status: 401 });
  }

  const event = JSON.parse(raw) as { event: string; data: { reference: string } };
  if (event.event !== "charge.success") return new Response("ignored", { status: 200 });

  // Re-verify with Paystack rather than trusting the webhook body alone.
  const v = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(event.data.reference)}`, {
    headers: { Authorization: `Bearer ${SECRET}` },
  }).then((r) => r.json());
  const tx = v?.data;
  if (!v?.status || tx?.status !== "success") return new Response("not successful", { status: 200 });

  const institutionId: string | undefined = tx.metadata?.institution_id;
  const planCode: string | undefined = tx.metadata?.plan_code;
  if (!institutionId || !planCode) return new Response("missing metadata", { status: 200 });

  const { data: plan } = await db.from("subscription_plans").select("id, price_cents, currency, billing_interval").eq("code", planCode).single();
  if (!plan || plan.price_cents == null || tx.amount !== plan.price_cents || tx.currency !== plan.currency) {
    // Record it for a human to look at, but do not grant anything.
    await db.from("payments").upsert({
      institution_id: institutionId, provider: "paystack", provider_ref: tx.reference,
      amount_cents: tx.amount, currency: tx.currency, status: "failed",
    }, { onConflict: "provider,provider_ref" });
    return new Response("amount mismatch recorded", { status: 200 });
  }

  // Idempotent: a replayed webhook finds the existing payment and stops.
  const { data: existing } = await db.from("payments").select("id, status").eq("provider", "paystack").eq("provider_ref", tx.reference).maybeSingle();
  if (existing?.status === "succeeded") return new Response("already processed", { status: 200 });

  const { data: sub } = await db.from("institution_subscriptions").select("id, current_period_end")
    .eq("institution_id", institutionId).in("status", ["trialing", "active", "past_due", "suspended"]).maybeSingle();
  const from = sub && new Date(sub.current_period_end) > new Date() ? new Date(sub.current_period_end) : new Date();
  const until = new Date(from);
  if (plan.billing_interval === "year") until.setFullYear(until.getFullYear() + 1);
  else until.setMonth(until.getMonth() + 1);

  let subscriptionId = sub?.id;
  if (sub) {
    await db.from("institution_subscriptions").update({ plan_id: plan.id, status: "active", current_period_end: until.toISOString() }).eq("id", sub.id);
  } else {
    const { data: created } = await db.from("institution_subscriptions")
      .insert({ institution_id: institutionId, plan_id: plan.id, status: "active", current_period_end: until.toISOString() })
      .select("id").single();
    subscriptionId = created?.id;
  }
  await db.from("payments").upsert({
    institution_id: institutionId, subscription_id: subscriptionId, provider: "paystack", provider_ref: tx.reference,
    amount_cents: tx.amount, currency: tx.currency, status: "succeeded", verified_at: new Date().toISOString(),
  }, { onConflict: "provider,provider_ref" });

  return new Response("ok", { status: 200 });
});
