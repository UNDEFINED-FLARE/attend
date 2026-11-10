import { beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "./harness";

// Campus location sharing + class navigation (migration 0013).
// Privacy rules under test: off until the institution enables it AND the student
// consents; only the latest position is kept; it disappears when the student
// leaves campus (unless they chose safety sharing), stops, or withdraws; only
// their own institution's admins can see it.

// UNIVEN-ish. A ~400 m square campus around the hall; 0.01° lat ≈ 1.1 km.
const HALL = { lat: -22.9761, lng: 30.4445 };
const D = 0.0018;
const CAMPUS = [
  [HALL.lat - D, HALL.lng - D], [HALL.lat - D, HALL.lng + D],
  [HALL.lat + D, HALL.lng + D], [HALL.lat + D, HALL.lng - D],
];
const OUTSIDE = { lat: HALL.lat + 0.01, lng: HALL.lng };

let db: Db;
const u: Record<string, string> = {};
const id: Record<string, string> = {};

type Report = { stored: boolean; on_campus?: boolean; reason?: string; mode?: string; campus?: string };
const report = async (user: string, at: { lat: number; lng: number }, safety = false, inst = id.inst) =>
  (await db.asOne<{ report_location: Report }>(user,
    "select uniattend.report_location($1, $2, $3, 15, $4)", [inst, at.lat, at.lng, safety])).report_location;
const liveFor = (user: string, inst = id.inst) =>
  db.as<{ full_name: string; student_number: string; on_campus: boolean; mode: string; campus_name: string }>(
    user, "select * from uniattend.campus_live_locations($1)", [inst]);

async function institution(tag: string) {
  const admin = await db.newUser(`admin@${tag}.ac.za`);
  const inst = (await db.asOne<{ request_institution: string }>(admin,
    "select uniattend.request_institution($1, $2)", [`Uni ${tag}`, `uni-${tag}`])).request_institution;
  await db.as(u.super, "select uniattend.set_institution_status($1, 'active')", [inst]);
  return { admin, inst };
}

beforeAll(async () => {
  db = await createDb();
  u.super = await db.newUser("root@uniattend.app");
  await db.admin("insert into uniattend.user_roles (user_id, role) values ($1, 'super_admin')", [u.super]);

  ({ admin: u.admin, inst: id.inst } = await institution("loc"));
  ({ admin: u.otherAdmin, inst: id.other } = await institution("far"));

  const campus = await db.asOne<{ id: string }>(u.admin,
    "insert into uniattend.campuses (institution_id, name, lat, lng, outline) values ($1, 'Main campus', $2, $3, $4) returning id",
    [id.inst, HALL.lat, HALL.lng, JSON.stringify(CAMPUS)]);
  id.campus = campus.id;
  const fac = await db.asOne<{ id: string }>(u.admin, "insert into uniattend.faculties (institution_id, name, code) values ($1, 'Sci', 'SCI') returning id", [id.inst]);
  const dep = await db.asOne<{ id: string }>(u.admin, "insert into uniattend.departments (institution_id, faculty_id, name, code) values ($1, $2, 'CS', 'CSC') returning id", [id.inst, fac.id]);
  const ven = await db.asOne<{ id: string }>(u.admin,
    "insert into uniattend.venues (institution_id, campus_id, name, code, lat, lng, radius_m) values ($1, $2, 'Hall 1', 'H1', $3, $4, 40) returning id",
    [id.inst, id.campus, HALL.lat, HALL.lng]);
  id.venue = ven.id;
  const mod = await db.asOne<{ id: string }>(u.admin,
    "insert into uniattend.modules (institution_id, department_id, code, title) values ($1, $2, 'CSC101', 'Intro to CS') returning id", [id.inst, dep.id]);
  id.mod = mod.id;
  // a class every day of the week, so "next class" always has an answer
  for (let wd = 1; wd <= 7; wd++) {
    await db.as(u.admin, "insert into uniattend.timetables (institution_id, module_id, venue_id, weekday, starts_at, ends_at) values ($1, $2, $3, $4, '00:00', '23:59')",
      [id.inst, id.mod, id.venue, wd]);
  }
  await db.as(u.admin, "select uniattend.import_students($1, $2)", [id.inst,
    JSON.stringify([1, 2].map((n) => ({ student_number: `L00${n}`, full_name: `Loc Student ${n}`, email: `s${n}@loc.ac.za`, module_code: "CSC101" })))]);
  for (const n of [1, 2]) {
    u[`s${n}`] = await db.newUser(`s${n}@loc.ac.za`);
    await db.as(u[`s${n}`], "select uniattend.link_my_accounts()");
  }
}, 120_000);

describe("switched off until the institution and the student both agree", () => {
  it("does nothing while the institution has not enabled it", async () => {
    await db.as(u.s1, "select uniattend.set_location_consent($1, true)", [id.inst]);
    expect(await report(u.s1, HALL)).toMatchObject({ stored: false, reason: "disabled" });
  });

  it("requires the student's own consent", async () => {
    await db.as(u.admin, "update uniattend.institution_settings set location_sharing_enabled = true where institution_id = $1", [id.inst]);
    await expect(report(u.s2, HALL)).rejects.toThrow(/agree/i);
  });

  it("only students can share (not admins or strangers)", async () => {
    await expect(db.as(u.admin, "select uniattend.set_location_consent($1, true)", [id.inst])).rejects.toThrow(/students only/);
    await expect(db.as(u.otherAdmin, "select uniattend.report_location($1, 0, 0, 10, false)", [id.inst])).rejects.toThrow(/students only/);
  });
});

describe("on campus vs off campus", () => {
  it("on campus: stored and visible to this institution's admin with the student's name", async () => {
    expect(await report(u.s1, HALL)).toMatchObject({ stored: true, on_campus: true, mode: "campus", campus: "Main campus" });
    const rows = await liveFor(u.admin);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ full_name: "Loc Student 1", student_number: "L001", on_campus: true });
  });

  it("only the latest position is kept (no history)", async () => {
    await report(u.s1, { lat: HALL.lat + 0.0005, lng: HALL.lng });
    const n = await db.admin<{ n: number }>("select count(*)::int as n from uniattend.live_locations where user_id = $1", [u.s1]);
    expect(n[0].n).toBe(1);
  });

  it("leaving campus switches sharing off automatically and removes the position", async () => {
    expect(await report(u.s1, OUTSIDE)).toMatchObject({ stored: false, on_campus: false, reason: "off_campus" });
    expect(await liveFor(u.admin)).toHaveLength(0);
  });

  it("off campus with safety sharing turned on by the student: stored as 'safety'", async () => {
    expect(await report(u.s1, OUTSIDE, true)).toMatchObject({ stored: true, on_campus: false, mode: "safety" });
    expect((await liveFor(u.admin))[0]).toMatchObject({ mode: "safety", on_campus: false });
  });

  it("stop sharing removes the position immediately", async () => {
    await db.as(u.s1, "select uniattend.stop_location_sharing($1)", [id.inst]);
    expect(await liveFor(u.admin)).toHaveLength(0);
  });
});

describe("who can see what", () => {
  beforeAll(async () => { await report(u.s1, HALL); });

  it("another institution's admin sees nothing", async () => {
    expect(await liveFor(u.otherAdmin)).toHaveLength(0);
    expect(await db.as(u.otherAdmin, "select * from uniattend.live_locations")).toHaveLength(0);
  });

  it("a student sees only their own position, not classmates'", async () => {
    await db.as(u.s2, "select uniattend.set_location_consent($1, true)", [id.inst]);
    await report(u.s2, HALL);
    const mine = await db.as<{ user_id: string }>(u.s2, "select user_id from uniattend.live_locations");
    expect(mine.map((r) => r.user_id)).toEqual([u.s2]);
  });

  it("nobody can write positions directly, only through report_location", async () => {
    await expect(db.as(u.s1, "update uniattend.live_locations set lat = 0 where user_id = $1", [u.s1])).rejects.toThrow(/permission denied/);
    await expect(db.as(u.s1, "insert into uniattend.live_locations (institution_id, user_id, lat, lng, accuracy_m, on_campus, mode) values ($1, $2, 0, 0, 5, true, 'campus')", [id.inst, u.s1]))
      .rejects.toThrow(/permission denied/);
  });

  it("anonymous visitors get nothing", async () => {
    await expect(db.as(null, "select * from uniattend.live_locations")).rejects.toThrow(/permission denied/);
    await expect(db.as(null, "select uniattend.campus_live_locations($1)", [id.inst])).rejects.toThrow(/permission denied/);
  });

  it("withdrawing consent deletes the position and blocks further reports", async () => {
    await db.as(u.s2, "select uniattend.set_location_consent($1, false)", [id.inst]);
    expect((await liveFor(u.admin)).map((r) => r.full_name)).not.toContain("Loc Student 2");
    await expect(report(u.s2, HALL)).rejects.toThrow(/agree/i);
  });

  it("turning the feature off institution-wide removes positions on the next report", async () => {
    await db.as(u.admin, "update uniattend.institution_settings set location_sharing_enabled = false where institution_id = $1", [id.inst]);
    expect(await report(u.s1, HALL)).toMatchObject({ stored: false, reason: "disabled" });
    expect(await liveFor(u.admin)).toHaveLength(0);
    await db.as(u.admin, "update uniattend.institution_settings set location_sharing_enabled = true where institution_id = $1", [id.inst]);
  });
});

describe("campus boundary and class navigation", () => {
  it("a campus boundary needs at least 3 points", async () => {
    await expect(db.as(u.admin, "update uniattend.campuses set outline = '[[1,2],[3,4]]' where id = $1", [id.campus]))
      .rejects.toThrow(/check constraint/);
  });

  it("a student's next classes come with the venue's location", async () => {
    const rows = await db.as<{ module_code: string; venue_name: string; lat: number; lng: number; starts_at: string }>(
      u.s1, "select * from uniattend.my_next_classes($1)", [id.inst]);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({ module_code: "CSC101", venue_name: "Hall 1", lat: HALL.lat, lng: HALL.lng });
  });

  it("someone not enrolled gets no classes", async () => {
    expect(await db.as(u.admin, "select * from uniattend.my_next_classes($1)", [id.inst])).toHaveLength(0);
  });
});
