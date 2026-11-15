import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "./harness";

// Internal controls (migration 0008): step-up ("confirm it's you") on dangerous
// actions, alerts to other admins, new-device sign-in alerts, last-admin guard.
let db: Db;
const u: Record<string, string> = {};
const id: Record<string, string> = {};
const hex = (c: string) => c.repeat(64);

const notifs = (user: string, kind?: string) =>
  db.as<{ kind: string; title: string; body: string }>(user,
    "select kind, title, body from public.notifications where user_id = $1" + (kind ? " and kind = $2" : "") + " order by created_at",
    kind ? [user, kind] : [user]);

beforeAll(async () => {
  db = await createDb();
  u.super = await db.newUser("root@uniattend.app");
  await db.admin("insert into public.user_roles (user_id, role) values ($1, 'super_admin')", [u.super]);
  await db.stepUp(u.super);

  u.admin = await db.newUser("admin@u.ac.za");
  id.inst = (await db.asOne<{ request_institution: string }>(u.admin,
    "select public.request_institution('Uni', 'uni')")).request_institution;
  await db.as(u.super, "select public.set_institution_status($1, 'active')", [id.inst]);

  // a second admin and two ordinary members, all with confirmed accounts
  u.admin2 = await db.newUser("admin2@u.ac.za");
  u.lect = await db.newUser("lect@u.ac.za");
  u.student = await db.newUser("student@u.ac.za");
}, 120_000);

beforeEach(async () => { await db.stepUp(u.admin); }); // admin starts each test having confirmed

describe("step-up is required for dangerous actions", () => {
  it("blocks grant_role without a recent confirmation, with code P0004", async () => {
    await db.expireStepUp(u.admin);
    await expect(db.as(u.admin, "select public.grant_role($1, 'lect@u.ac.za', 'lecturer')", [id.inst]))
      .rejects.toThrow(/Confirm it's you/);
  });

  it("allows it once confirmed, and the confirmation covers more than one action", async () => {
    await db.as(u.admin, "select public.grant_role($1, 'lect@u.ac.za', 'lecturer')", [id.inst]);
    await db.as(u.admin, "select public.grant_role($1, 'admin2@u.ac.za', 'institution_admin')", [id.inst]);
    const roles = await db.as(u.admin, "select role from public.user_roles where institution_id = $1 order by role", [id.inst]);
    expect(roles.map((r) => r.role)).toEqual(["institution_admin", "institution_admin", "lecturer"]);
  });

  it("stops applying once the 20-minute window passes", async () => {
    await db.expireStepUp(u.admin);
    await expect(db.as(u.admin, "select public.grant_role($1, 'student@u.ac.za', 'student')", [id.inst]))
      .rejects.toThrow(/Confirm it's you/);
  });

  it("an unauthorised caller still fails on authority first, not on step-up", async () => {
    // the lecturer never has admin rights; they should get the authority error, no leak that step-up exists
    await expect(db.as(u.lect, "select public.grant_role($1, 'student@u.ac.za', 'student')", [id.inst]))
      .rejects.toThrow(/institution admin only/);
  });
});

describe("alerts to other admins and the affected person", () => {
  it("granting a role notifies the new holder and the other admins, not the actor", async () => {
    // u.admin and u.admin2 are both admins now (from the earlier test). admin grants the lecturer.
    await db.as(u.admin, "select public.grant_role($1, 'lect@u.ac.za', 'lecturer')", [id.inst]);
    expect((await notifs(u.lect, "role_granted")).length).toBeGreaterThan(0);
    const toAdmin2 = await notifs(u.admin2, "role_change");
    expect(toAdmin2.some((n) => /lecturer added/i.test(n.title))).toBe(true);
    // the admin who did it is not notified about their own action
    expect(await notifs(u.admin, "role_change")).toEqual([]);
  });

  it("a super-admin subscription change notifies the institution's admins", async () => {
    await db.as(u.super, "select public.change_subscription($1, 'starter', 'active', now() + interval '1 year')", [id.inst]);
    expect((await notifs(u.admin, "subscription")).length).toBeGreaterThan(0);
  });
});

describe("the last administrator cannot be removed", () => {
  it("refuses to suspend the only admin, but allows it once a second admin exists", async () => {
    const solo = await db.newUser("solo@u.ac.za");
    const inst = (await db.asOne<{ request_institution: string }>(solo,
      "select public.request_institution('Solo U', 'solo-u')")).request_institution;
    await db.as(u.super, "select public.set_institution_status($1, 'active')", [inst]);
    await db.stepUp(solo);
    const soloRole = (await db.asOne<{ id: string }>(u.super,
      "select id from public.user_roles where user_id = $1 and institution_id = $2", [solo, inst])).id;

    // the only admin cannot be suspended by the super admin either
    await expect(db.as(u.super, "select public.set_role_status($1, 'suspended')", [soloRole]))
      .rejects.toThrow(/only administrator/);

    // add a second admin, then the first can be suspended
    const two = await db.newUser("two@u.ac.za");
    await db.as(solo, "select public.grant_role($1, 'two@u.ac.za', 'institution_admin')", [inst]);
    await db.as(u.super, "select public.set_role_status($1, 'suspended')", [soloRole]);
    const left = await db.asOne<{ n: number }>(u.super,
      "select count(*)::int as n from public.user_roles where institution_id = $1 and role = 'institution_admin' and status = 'active'", [inst]);
    expect(left.n).toBe(1);
  });

  it("an admin still cannot suspend their own access", async () => {
    const r = (await db.asOne<{ id: string }>(u.super,
      "select id from public.user_roles where user_id = $1 and institution_id = $2 and role = 'institution_admin'", [u.admin, id.inst])).id;
    await expect(db.as(u.admin, "select public.set_role_status($1, 'suspended')", [r]))
      .rejects.toThrow(/your own access/);
  });
});

describe("new-device sign-in alerts", () => {
  it("does not alert on the very first device, alerts on a second, and never for non-admins", async () => {
    await db.as(u.admin, "select public.note_sign_in($1, 'Chrome on Windows')", [hex("a")]);
    expect(await notifs(u.admin, "new_device")).toEqual([]); // first device is the baseline
    await db.as(u.admin, "select public.note_sign_in($1, 'Safari on iPhone')", [hex("b")]);
    const alerts = await notifs(u.admin, "new_device");
    expect(alerts.length).toBe(1);
    expect(alerts[0]!.body).toMatch(/not you/i);
    // a plain student gets no new-device alerts even on a new device
    await db.as(u.student, "select public.note_sign_in($1, 'd1')", [hex("c")]);
    await db.as(u.student, "select public.note_sign_in($1, 'd2')", [hex("d")]);
    expect(await notifs(u.student, "new_device")).toEqual([]);
  });

  it("re-signing in on a known device raises no new alert", async () => {
    await db.as(u.admin, "select public.note_sign_in($1, 'Chrome on Windows')", [hex("a")]);
    expect((await notifs(u.admin, "new_device")).length).toBe(1); // still just the one from before
  });

  it("users cannot write the step-up or known-device tables directly", async () => {
    await expect(db.as(u.admin, "insert into public.admin_step_up (user_id) values ($1)", [u.admin]))
      .rejects.toThrow(/permission denied|row-level security/);
    await expect(db.as(u.admin, "insert into public.known_devices (user_id, device_hash) values ($1, $2)", [u.admin, hex("e")]))
      .rejects.toThrow(/permission denied|row-level security/);
  });
});
