import { beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "./harness";

// Regression tests for the 2026-11-10 security review:
//  1. tables must be granted explicitly (Supabase stopped doing it on 2026-10-30)
//  3. grant_role only targets confirmed accounts
//  4. Paystack payments are applied exactly once, atomically
let db: Db;
let superId: string, adminId: string, inst: string;

beforeAll(async () => {
  db = await createDb();
  superId = await db.newUser("root@uniattend.app");
  await db.admin("insert into public.user_roles (user_id, role) values ($1, 'super_admin')", [superId]);
  await db.stepUp(superId);
  adminId = await db.newUser("admin@sec.ac.za");
  inst = (await db.asOne<{ request_institution: string }>(adminId,
    "select public.request_institution('Security U', 'sec-u')")).request_institution;
  await db.stepUp(adminId); // admin confirmed identity, so grant_role tests exercise the real path
  await db.as(superId, "select public.set_institution_status($1, 'active')", [inst]);
  await db.admin("update public.subscription_plans set price_cents = 120000, currency = 'ZAR', billing_interval = 'year' where code = 'starter'");
}, 120_000);

describe("1. explicit table grants", () => {
  it("signed-in users reach tables through the Data API roles (RLS still filters rows)", async () => {
    const rows = await db.as(adminId, "select id from public.institutions where id = $1", [inst]);
    expect(rows).toHaveLength(1);
  });

  it("anonymous visitors cannot touch any table", async () => {
    for (const t of ["profiles", "institutions", "subscription_plans", "notifications"]) {
      await expect(db.as(null, `select 1 from public.${t} limit 1`), t).rejects.toThrow(/permission denied/);
    }
  });

  it("server-side code (service_role) can read payments for the webhook", async () => {
    await expect(db.asService("select count(*) from public.payments")).resolves.toBeDefined();
  });

  it("secret tables are not granted to signed-in users at all", async () => {
    for (const t of ["session_secrets", "acoustic_submissions"]) {
      await expect(db.as(adminId, `select 1 from public.${t} limit 1`), t).rejects.toThrow(/permission denied/);
    }
  });
});

describe("3. grant_role needs a confirmed email", () => {
  it("refuses an account whose email was never confirmed", async () => {
    await db.newUser("squatter@sec.ac.za", { confirmed: false });
    await expect(db.as(adminId, "select public.grant_role($1, 'squatter@sec.ac.za', 'lecturer')", [inst]))
      .rejects.toThrow(/confirm/i);
  });

  it("still works for a confirmed account", async () => {
    await db.newUser("real.lecturer@sec.ac.za");
    const r = await db.asOne<{ grant_role: string }>(adminId,
      "select public.grant_role($1, 'real.lecturer@sec.ac.za', 'lecturer')", [inst]);
    expect(r.grant_role).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("4. Paystack payments apply exactly once", () => {
  const pay = (ref: string, amount = 120000, plan = "starter") =>
    db.asService<{ apply_paystack_payment: string }>(
      "select public.apply_paystack_payment($1, $2, $3, $4, 'ZAR')", [inst, plan, ref, amount]);
  const periodEnd = async () => (await db.admin<{ end: Date }>(
    "select max(current_period_end) as end from public.institution_subscriptions where institution_id = $1 and status = 'active'", [inst]))[0].end;

  it("applies a correct payment and extends the subscription by the plan interval", async () => {
    expect((await pay("ref-1"))[0].apply_paystack_payment).toBe("applied");
    const end = new Date(await periodEnd());
    const days = (end.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(360);
  });

  it("a replayed webhook for the same reference changes nothing", async () => {
    const before = new Date(await periodEnd()).getTime();
    expect((await pay("ref-1"))[0].apply_paystack_payment).toBe("duplicate");
    expect(new Date(await periodEnd()).getTime()).toBe(before);
    const n = await db.admin<{ n: number }>("select count(*)::int as n from public.payments where provider_ref = 'ref-1'");
    expect(n[0].n).toBe(1);
  });

  it("a wrong amount is recorded as failed and grants nothing", async () => {
    const before = new Date(await periodEnd()).getTime();
    expect((await pay("ref-2", 100))[0].apply_paystack_payment).toBe("mismatch");
    expect(new Date(await periodEnd()).getTime()).toBe(before);
    const p = await db.admin<{ status: string }>("select status from public.payments where provider_ref = 'ref-2'");
    expect(p[0].status).toBe("failed");
  });

  it("a pending payment row created at checkout is promoted once", async () => {
    await db.admin("insert into public.payments (institution_id, provider, provider_ref, amount_cents, currency, status) values ($1, 'paystack', 'ref-3', 120000, 'ZAR', 'pending')", [inst]);
    expect((await pay("ref-3"))[0].apply_paystack_payment).toBe("applied");
    expect((await pay("ref-3"))[0].apply_paystack_payment).toBe("duplicate");
  });

  it("only server-side code may call it", async () => {
    await expect(db.as(adminId, "select public.apply_paystack_payment($1, 'starter', 'ref-x', 120000, 'ZAR')", [inst]))
      .rejects.toThrow(/permission denied/);
    await expect(db.as(null, "select public.apply_paystack_payment($1, 'starter', 'ref-y', 120000, 'ZAR')", [inst]))
      .rejects.toThrow(/permission denied/);
  });
});
