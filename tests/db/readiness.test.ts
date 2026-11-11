import { beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "./harness";

// Readiness fixes (migration 0018, docs/capacity/10k-readiness-report.md):
//  * the indexes the report lists as missing exist;
//  * S-1: an unapproved institution can't attach people to itself, and grant_role is
//    no longer a way to test whether an email has an account.

let db: Db;
const u: Record<string, string> = {};
const id: Record<string, string> = {};

const rolesOf = (user: string) =>
  db.admin<{ role: string; institution_id: string | null }>("select role, institution_id from uniattend.user_roles where user_id = $1 order by role", [user]);

beforeAll(async () => {
  db = await createDb();
  u.super = await db.newUser("root@uniattend.app");
  await db.admin("insert into uniattend.user_roles (user_id, role) values ($1, 'super_admin')", [u.super]);

  // An institution that registered but isn't approved yet.
  u.newAdmin = await db.newUser("admin@new-u.test");
  id.pending = (await db.asOne<{ request_institution: string }>(u.newAdmin,
    "select uniattend.request_institution('New U', 'new-u')")).request_institution;

  // An approved institution.
  u.admin = await db.newUser("admin@good-u.test");
  id.good = (await db.asOne<{ request_institution: string }>(u.admin,
    "select uniattend.request_institution('Good U', 'good-u')")).request_institution;
  await db.as(u.super, "select uniattend.set_institution_status($1, 'active')", [id.good]);

  // Someone with a confirmed account (e.g. a user of the other app sharing the project).
  u.person = await db.newUser("person@elsewhere.test");
}, 120_000);

describe("indexes from the readiness report", () => {
  it("exist", async () => {
    const want = ["attendance_disputes_student", "class_sessions_lecturer", "class_sessions_venue", "verification_events_session"];
    const rows = await db.admin<{ indexname: string }>(
      "select indexname from pg_indexes where schemaname = 'uniattend' and indexname = any($1) order by 1", [want]);
    expect(rows.map((r) => r.indexname)).toEqual(want);
  });
});

describe("S-1: an unapproved institution can't attach people", () => {
  it("grant_role is refused until UniAttend approves the institution", async () => {
    await expect(db.as(u.newAdmin, "select uniattend.grant_role($1, 'person@elsewhere.test', 'student')", [id.pending]))
      .rejects.toThrow(/approved/);
    expect(await rolesOf(u.person)).toHaveLength(0);
  });

  it("it can still set up its students, but nobody is linked before approval", async () => {
    await db.as(u.newAdmin, "select uniattend.import_students($1, $2)",
      [id.pending, JSON.stringify([{ student_number: "N001", full_name: "Person", email: "person@elsewhere.test" }])]);
    const r = await db.asOne<{ link_my_accounts: { students: number } }>(u.person, "select uniattend.link_my_accounts()");
    expect(r.link_my_accounts.students).toBe(0);
    expect(await rolesOf(u.person)).toHaveLength(0);
    // ...so the unapproved admin can't read that person's profile either
    expect(await db.as(u.newAdmin, "select * from uniattend.profiles where id = $1", [u.person])).toHaveLength(0);
  });

  it("once approved, the student is linked at their next sign-in", async () => {
    await db.as(u.super, "select uniattend.set_institution_status($1, 'active')", [id.pending]);
    const r = await db.asOne<{ link_my_accounts: { students: number } }>(u.person, "select uniattend.link_my_accounts()");
    expect(r.link_my_accounts.students).toBe(1);
    expect(await rolesOf(u.person)).toEqual([{ role: "student", institution_id: id.pending }]);
  });
});

describe("S-1: grant_role doesn't reveal whether an email has an account", () => {
  it("answers exactly the same for a confirmed account, an unconfirmed one and no account", async () => {
    u.unconfirmed = await db.newUser("unconfirmed@elsewhere.test", { confirmed: false });
    const answers = [];
    for (const email of ["person@elsewhere.test", "unconfirmed@elsewhere.test", "nobody@nowhere.test"]) {
      answers.push(JSON.stringify(await db.as(u.admin, "select uniattend.grant_role($1, $2, 'institution_admin') as r", [id.good, email])));
    }
    expect(new Set(answers).size).toBe(1);

    // behind the scenes: the confirmed account has the role now, the others are invitations
    expect((await rolesOf(u.person)).map((r) => r.role)).toContain("institution_admin");
    expect(await rolesOf(u.unconfirmed)).toHaveLength(0);
    const inv = await db.as<{ email: string }>(u.admin, "select email from uniattend.role_invitations order by email");
    expect(inv.map((r) => r.email)).toEqual(["nobody@nowhere.test", "unconfirmed@elsewhere.test"]);
  });

  it("someone invited gets the role when they sign up and confirm that email", async () => {
    const newcomer = await db.newUser("Nobody@Nowhere.test"); // case doesn't matter
    const r = await db.asOne<{ link_my_accounts: { roles: number } }>(newcomer, "select uniattend.link_my_accounts()");
    expect(r.link_my_accounts.roles).toBe(1);
    expect(await rolesOf(newcomer)).toEqual([{ role: "institution_admin", institution_id: id.good }]);
    expect(await db.admin("select 1 from uniattend.role_invitations where email = 'nobody@nowhere.test'")).toHaveLength(0);
  });

  it("an unconfirmed account gets nothing until it confirms its email", async () => {
    await db.as(u.unconfirmed, "select uniattend.link_my_accounts()");
    expect(await rolesOf(u.unconfirmed)).toHaveLength(0);
    await db.admin("update auth.users set email_confirmed_at = now() where id = $1", [u.unconfirmed]);
    await db.as(u.unconfirmed, "select uniattend.link_my_accounts()");
    expect(await rolesOf(u.unconfirmed)).toEqual([{ role: "institution_admin", institution_id: id.good }]);
  });

  it("invitations can't be written directly, and only that institution's admins see them", async () => {
    await db.as(u.admin, "select uniattend.grant_role($1, 'later@nowhere.test', 'lecturer')", [id.good]);
    expect(await db.as(u.newAdmin, "select * from uniattend.role_invitations")).toHaveLength(0);
    await expect(db.as(u.admin, "insert into uniattend.role_invitations (institution_id, email, role) values ($1, 'x@y.test', 'student')", [id.good]))
      .rejects.toThrow(/permission denied/);
  });

  it("rejects a malformed email and unknown roles; super admins keep their own path", async () => {
    await expect(db.as(u.admin, "select uniattend.grant_role($1, 'not-an-email', 'lecturer')", [id.good])).rejects.toThrow(/valid email/);
    await expect(db.as(u.admin, "select uniattend.grant_role($1, 'a@b.test', 'super_admin')", [id.good])).rejects.toThrow(/super admin only/);
    await expect(db.as(u.super, "select uniattend.grant_role(null, 'nobody2@nowhere.test', 'super_admin')")).rejects.toThrow(/No confirmed account/);
  });
});
