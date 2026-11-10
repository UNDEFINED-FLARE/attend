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
  db: { schema: "uniattend" },
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

  let event: { event: string; data: { reference: string } };
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }
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

  // Amount check, claiming the payment and extending the subscription all happen
  // in ONE database transaction (migration 0012), so two simultaneous deliveries
  // of the same webhook can never extend the subscription twice.
  const { data: result, error } = await db.rpc("apply_paystack_payment", {
    p_institution: institutionId, p_plan_code: planCode, p_reference: tx.reference,
    p_amount: tx.amount, p_currency: tx.currency,
  });
  if (error) {
    // 500 makes Paystack retry later; the function is idempotent, so retries are safe.
    console.error("apply_paystack_payment failed", error.message);
    return new Response("temporary error", { status: 500 });
  }
  return new Response(String(result), { status: 200 });
});
