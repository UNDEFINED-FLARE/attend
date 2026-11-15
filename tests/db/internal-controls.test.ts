import { beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "./harness";

// Internal controls (migration 0035): step-up ("confirm it's you") on privileged
// role changes (gated by a platform flag, off by default), and new-device sign-in
// alerts. Enforcement is in the database, so a modified client cannot skip it.
// Verification reads use db.admin (bypasses RLS) — we are checking state, not access.
let db: Db;
const u: Record<string, string> = {};
const id: Record<string, string> = {};

const enableStepUp = (on: boolean) => db.asService(`update uniattend.security_settings set step_up_enabled = ${on}`);
const giveStepUp = (user: string) => db.asService(
  `insert into uniattend.admin_step_up (user_id, verified_at) values ('${user}', now())
   on conflict (user_id) do update set verified_at = now()`);
const expireStepUp = (user: string) => db.asService(
  `update uniattend.admin_step_up set verified_at = now() - interval '1 hour' where user_id = '${user}'`);
const grant = (actor: string, email: string, role: string) =>
  db.as(actor, "select uniattend.grant_role($1, $2, $3, null, null)", [id.inst, email, role]);
const roleOf = async (user: string) =>
  (await db.admin<{ role: string; status: string }>(
    "select role, status from uniattend.user_roles where user_id = $1 order by created_at desc limit 1", [user]))[0];
const notifs = (user: string, kind: string) =>
  db.as<{ title: string; body: string }>(user,
    "select title, body from uniattend.notifications where user_id = $1 and kind = $2", [user, kind]);

beforeAll(async () => {
  db = await createDb();
  u.super = await db.newUser("root@uniattend.app");
  await db.admin("insert into uniattend.user_roles (user_id, role) values ($1, 'super_admin')", [u.super]);

  u.admin = await db.newUser("admin@u.ac.za");
  id.inst = (await db.asOne<{ request_institution: string }>(u.admin,
    "select uniattend.request_institution('Uni', 'uni')")).request_institution;
  await db.as(u.super, "select uniattend.set_institution_status($1, 'active')", [id.inst]);

  for (const name of ["t1", "t2", "t3", "t4", "staff"]) u[name] = await db.newUser(`${name}@u.ac.za`);
}, 120_000);

describe("default (flag off): nothing changes", () => {
  it("an admin can grant a role with no step-up", async () => {
    await grant(u.admin, "t1@u.ac.za", "institution_admin");
    expect((await roleOf(u.t1)).role).toBe("institution_admin");
  });
});

describe("step-up enforced when the platform flag is on", () => {
  beforeAll(() => enableStepUp(true));

  it("blocks a privileged grant without a recent confirmation (P0004)", async () => {
    await expireStepUp(u.admin);
    await expect(grant(u.admin, "t2@u.ac.za", "institution_admin")).rejects.toThrow(/Confirm it's you/);
  });

  it("allows it once confirmed, and the confirmation covers more than one action", async () => {
    await giveStepUp(u.admin);
    await grant(u.admin, "t2@u.ac.za", "institution_admin");
    await grant(u.admin, "t3@u.ac.za", "institution_admin");
    expect((await roleOf(u.t2)).role).toBe("institution_admin");
    expect((await roleOf(u.t3)).role).toBe("institution_admin");
  });

  it("does not require step-up for a non-privileged role (lecturer)", async () => {
    await expireStepUp(u.admin);
    await grant(u.admin, "t4@u.ac.za", "lecturer"); // must NOT throw
    expect((await roleOf(u.t4)).role).toBe("lecturer");
  });

  it("does not block self-service (a new user creating their own institution)", async () => {
    const solo = await db.newUser("solo@u.ac.za");
    const inst = (await db.asOne<{ request_institution: string }>(solo,
      "select uniattend.request_institution('Solo', 'solo')")).request_institution;
    expect(inst).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("blocks suspending another admin without step-up, allows it with", async () => {
    await giveStepUp(u.admin);
    await grant(u.admin, "staff@u.ac.za", "institution_admin");
    const rid = (await db.admin<{ id: string }>(
      "select id from uniattend.user_roles where user_id = $1 and institution_id = $2", [u.staff, id.inst]))[0].id;
    await expireStepUp(u.admin);
    await expect(db.as(u.admin, "select uniattend.set_role_status($1, 'suspended')", [rid]))
      .rejects.toThrow(/Confirm it's you/);
    await giveStepUp(u.admin);
    await db.as(u.admin, "select uniattend.set_role_status($1, 'suspended')", [rid]);
    expect((await db.admin<{ status: string }>("select status from uniattend.user_roles where id = $1", [rid]))[0].status)
      .toBe("suspended");
  });

  it("only a super admin can turn the flag on or off", async () => {
    await giveStepUp(u.admin);
    await expect(db.as(u.admin, "select uniattend.set_step_up_enabled(false)")).rejects.toThrow(/super admin only/);
  });
});

describe("new-device sign-in alerts", () => {
  const dev = (c: string) => c.repeat(32);
  it("first device is baseline, a second alerts a privileged user, students never get it", async () => {
    await db.as(u.admin, "select uniattend.note_sign_in($1, 'Chrome on Windows')", [dev("a")]);
    expect(await notifs(u.admin, "new_device")).toEqual([]);
    await db.as(u.admin, "select uniattend.note_sign_in($1, 'Safari on iPhone')", [dev("b")]);
    const alerts = await notifs(u.admin, "new_device");
    expect(alerts.length).toBe(1);
    expect(alerts[0]!.body).toMatch(/not you/i);

    const stu = await db.newUser("stu@u.ac.za"); // no roles → not privileged
    await db.as(stu, "select uniattend.note_sign_in($1, 'Device 1')", [dev("c")]);
    await db.as(stu, "select uniattend.note_sign_in($1, 'Device 2')", [dev("d")]);
    expect(await notifs(stu, "new_device")).toEqual([]);
  });

  it("a known device re-signing in raises no new alert", async () => {
    await db.as(u.admin, "select uniattend.note_sign_in($1, 'Chrome on Windows')", [dev("a")]);
    expect((await notifs(u.admin, "new_device")).length).toBe(1);
  });
});

describe("the control tables cannot be written from the client", () => {
  it("users cannot insert step-up or known-device rows directly", async () => {
    await expect(db.as(u.admin, "insert into uniattend.admin_step_up (user_id) values ($1)", [u.admin]))
      .rejects.toThrow(/permission denied|row-level security|violates/);
    await expect(db.as(u.admin, "insert into uniattend.known_devices (user_id, device_hash) values ($1, 'xxxxxxxx')", [u.admin]))
      .rejects.toThrow(/permission denied|row-level security|violates/);
  });
});
