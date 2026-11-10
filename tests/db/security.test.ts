import { beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "./harness";

// Regression tests for the 2026-11-10 security review:
//  3. grant_role only targets confirmed accounts
//  4. Paystack payments are applied exactly once, atomically
let db: Db;
let superId: string, adminId: string, inst: string;

beforeAll(async () => {
  db = await createDb();
  superId = await db.newUser("root@uniattend.app");
  await db.admin("insert into uniattend.user_roles (user_id, role) values ($1, 'super_admin')", [superId]);
  adminId = await db.newUser("admin@sec.ac.za");
  inst = (await db.asOne<{ request_institution: string }>(adminId,
    "select uniattend.request_institution('Security U', 'sec-u')")).request_institution;
  await db.as(superId, "select uniattend.set_institution_status($1, 'active')", [inst]);
  await db.admin("update uniattend.subscription_plans set price_cents = 120000, currency = 'ZAR', billing_interval = 'year' where code = 'starter'");
}, 120_000);

describe("3. grant_role needs a confirmed email", () => {
  it("refuses an account whose email was never confirmed", async () => {
    await db.newUser("squatter@sec.ac.za", { confirmed: false });
    await expect(db.as(adminId, "select uniattend.grant_role($1, 'squatter@sec.ac.za', 'lecturer')", [inst]))
      .rejects.toThrow(/confirm/i);
  });

  it("still works for a confirmed account", async () => {
    await db.newUser("real.lecturer@sec.ac.za");
    const r = await db.asOne<{ grant_role: string }>(adminId,
      "select uniattend.grant_role($1, 'real.lecturer@sec.ac.za', 'lecturer')", [inst]);
    expect(r.grant_role).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("4. Paystack payments apply exactly once", () => {
  const pay = (ref: string, amount = 120000, plan = "starter") =>
    db.asService<{ apply_paystack_payment: string }>(
      "select uniattend.apply_paystack_payment($1, $2, $3, $4, 'ZAR')", [inst, plan, ref, amount]);
  const periodEnd = async () => (await db.admin<{ end: Date }>(
    "select max(current_period_end) as end from uniattend.institution_subscriptions where institution_id = $1 and status = 'active'", [inst]))[0].end;

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
    const n = await db.admin<{ n: number }>("select count(*)::int as n from uniattend.payments where provider_ref = 'ref-1'");
    expect(n[0].n).toBe(1);
  });

  it("a wrong amount is recorded as failed and grants nothing", async () => {
    const before = new Date(await periodEnd()).getTime();
    expect((await pay("ref-2", 100))[0].apply_paystack_payment).toBe("mismatch");
    expect(new Date(await periodEnd()).getTime()).toBe(before);
    const p = await db.admin<{ status: string }>("select status from uniattend.payments where provider_ref = 'ref-2'");
    expect(p[0].status).toBe("failed");
  });

  it("a pending payment row created at checkout is promoted once", async () => {
    await db.admin("insert into uniattend.payments (institution_id, provider, provider_ref, amount_cents, currency, status) values ($1, 'paystack', 'ref-3', 120000, 'ZAR', 'pending')", [inst]);
    expect((await pay("ref-3"))[0].apply_paystack_payment).toBe("applied");
    expect((await pay("ref-3"))[0].apply_paystack_payment).toBe("duplicate");
  });

  it("only server-side code may call it", async () => {
    await expect(db.as(adminId, "select uniattend.apply_paystack_payment($1, 'starter', 'ref-x', 120000, 'ZAR')", [inst]))
      .rejects.toThrow(/permission denied/);
    await expect(db.as(null, "select uniattend.apply_paystack_payment($1, 'starter', 'ref-y', 120000, 'ZAR')", [inst]))
      .rejects.toThrow(/permission denied/);
  });
});
