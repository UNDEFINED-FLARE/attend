import { beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "./harness";

// Campus boundaries and class navigation (migration 0013). Live location sharing
// from the same migration was removed in 0017.

// UNIVEN-ish. A ~400 m square campus around the hall; 0.01° lat ≈ 1.1 km.
const HALL = { lat: -22.9761, lng: 30.4445 };
const D = 0.0018;
const CAMPUS = [
  [HALL.lat - D, HALL.lng - D], [HALL.lat - D, HALL.lng + D],
  [HALL.lat + D, HALL.lng + D], [HALL.lat + D, HALL.lng - D],
];

let db: Db;
const u: Record<string, string> = {};
const id: Record<string, string> = {};


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

describe("live location sharing was removed (migration 0017)", () => {
  it("leaves no tables, settings or functions behind", async () => {
    const left = await db.admin<{ n: string }>(`
      select table_name as n from information_schema.tables where table_schema = 'uniattend' and table_name in ('live_locations','location_consents')
      union all select column_name from information_schema.columns where table_schema = 'uniattend' and table_name = 'institution_settings'
        and column_name in ('location_sharing_enabled','location_interval_s')
      union all select p.proname from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'uniattend'
        and p.proname in ('report_location','set_location_consent','stop_location_sharing','campus_live_locations')`);
    expect(left).toEqual([]);
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
