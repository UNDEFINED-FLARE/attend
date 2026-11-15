import { beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "./harness";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

// UNIVEN, roughly. Offsets of 0.005° latitude are ~550 m.
const HALL = { lat: -22.9761, lng: 30.4445 };
const near = (dLat = 0, acc = 12) => ({ lat: HALL.lat + dLat, lng: HALL.lng, accuracy: acc });
const gpsAt = (dLat = 0, acc = 12) => ({
  samples: [near(dLat, acc), near(dLat + 0.00002, acc + 3), near(dLat - 0.00001, acc + 1)],
});
const hex = (c: string) => c.repeat(64);

type Ids = Record<string, string>;
let db: Db;
const u: Ids = {}; // auth user ids
const id: Ids = {}; // row ids

async function setupInstitution(tag: "A" | "B") {
  const admin = await db.newUser(`admin${tag}@uni${tag}.ac.za`);
  u[`admin${tag}`] = admin;
  const inst = (await db.asOne<{ request_institution: string }>(
    admin, "select uniattend.request_institution($1, $2)", [`University ${tag}`, `uni-${tag.toLowerCase()}`],
  )).request_institution;
  id[`inst${tag}`] = inst;
  await db.as(u.super, "select uniattend.set_institution_status($1, 'active')", [inst]);

  // academic structure, written by the institution admin through RLS
  const fac = await db.asOne<{ id: string }>(admin,
    "insert into uniattend.faculties (institution_id, name, code) values ($1, 'Science', 'SCI') returning id", [inst]);
  const dep = await db.asOne<{ id: string }>(admin,
    "insert into uniattend.departments (institution_id, faculty_id, name, code) values ($1, $2, 'Computer Science', 'CSC') returning id",
    [inst, fac.id]);
  id[`dep${tag}`] = dep.id;
  const ven = await db.asOne<{ id: string }>(admin,
    "insert into uniattend.venues (institution_id, name, lat, lng, radius_m) values ($1, 'Hall 1', $2, $3, 40) returning id",
    [inst, HALL.lat, HALL.lng]);
  id[`venue${tag}`] = ven.id;
  const mod = await db.asOne<{ id: string }>(admin,
    "insert into uniattend.modules (institution_id, department_id, code, title) values ($1, $2, 'CSC101', 'Intro to CS') returning id",
    [inst, dep.id]);
  id[`mod${tag}`] = mod.id;

  // a lecturer and three students, linked to accounts by confirmed email
  const lect = await db.newUser(`lect${tag}@uni${tag}.ac.za`);
  u[`lect${tag}`] = lect;
  const l = await db.asOne<{ id: string }>(admin,
    "insert into uniattend.lecturers (institution_id, staff_number, full_name, email) values ($1, 'L1', 'Dr Lecturer', $2) returning id",
    [inst, `lect${tag}@uni${tag}.ac.za`]);
  await db.as(admin, "insert into uniattend.lecturer_assignments (institution_id, module_id, lecturer_id) values ($1, $2, $3)",
    [inst, mod.id, l.id]);
  await db.as(lect, "select uniattend.link_my_accounts()");

  const rows = [1, 2, 3].map((n) => ({
    student_number: `${tag}00${n}`, full_name: `Student ${tag}${n}`,
    email: `s${n}@uni${tag}.ac.za`, module_code: "CSC101",
  }));
  const imp = await db.asOne<{ import_students: { inserted: number; enrolled: number } }>(admin,
    "select uniattend.import_students($1, $2)", [inst, JSON.stringify(rows)]);
  expect(imp.import_students).toMatchObject({ inserted: 3, enrolled: 3 });
  for (const n of [1, 2, 3]) {
    const s = await db.newUser(`s${n}@uni${tag}.ac.za`);
    u[`s${tag}${n}`] = s;
    await db.as(s, "select uniattend.link_my_accounts()");
  }
}

beforeAll(async () => {
  db = await createDb();
  u.super = await db.newUser("root@uniattend.app");
  await db.admin("insert into uniattend.user_roles (user_id, role) values ($1, 'super_admin')", [u.super]);
  await setupInstitution("A");
  await setupInstitution("B");
}, 240_000);

async function openSession(tag: "A" | "B") {
  const s = await db.asOne<{ id: string; join_code: string; require_gps: boolean }>(u[`lect${tag}`],
    "select * from uniattend.open_session($1, $2, 'Week 1', 90, 10)", [id[`mod${tag}`], id[`venue${tag}`]]);
  const t = await db.asOne<{ session_qr_token: { token: string } }>(u[`lect${tag}`],
    "select uniattend.session_qr_token($1)", [s.id]);
  return { ...s, token: t.session_qr_token.token };
}

type Verdict = { outcome: string; status: string | null; score: number; reasons: string[] };
const checkIn = async (user: string, session: string | null, code: string | null, token: string | null,
                       gps: object | null, device: string | null) =>
  (await db.asOne<{ check_in: Verdict }>(user, "select uniattend.check_in($1, $2, $3, $4, $5)",
    [session, code, token, gps ? JSON.stringify(gps) : null, device])).check_in;

describe("roles are granted, never claimed", () => {
  it("ignores a role in signup metadata", async () => {
    const x = await db.newUser("sneaky@example.com", { meta: { app: "uniattend", role: "lecturer", aa_role: "lecturer" } });
    expect(await db.as(x, "select * from uniattend.my_roles()")).toEqual([]);
    expect(await db.as(x, "select * from uniattend.profiles where id = $1", [x])).toHaveLength(1);
  });

  it("users of other apps sharing the project get no UniAttend profile until they use it", async () => {
    const x = await db.newUser("member@acvosa.org");
    expect(await db.admin("select * from uniattend.profiles where id = $1", [x])).toHaveLength(0);
    await db.as(x, "select uniattend.link_my_accounts()");
    expect(await db.admin("select * from uniattend.profiles where id = $1", [x])).toHaveLength(1);
  });

  it("does not link a student record to an unconfirmed email", async () => {
    await db.as(u.adminA, "insert into uniattend.students (institution_id, student_number, full_name, email) values ($1, 'A099', 'Pending', 'late@uniA.ac.za')", [id.instA]);
    const x = await db.newUser("late@uniA.ac.za", { confirmed: false });
    const r = await db.asOne<{ link_my_accounts: { linked: boolean } }>(x, "select uniattend.link_my_accounts()");
    expect(r.link_my_accounts.linked).toBe(false);
    expect(await db.as(x, "select * from uniattend.my_roles()")).toEqual([]);
  });

  it("an institution admin cannot change their own institution's status", async () => {
    await expect(db.as(u.adminA, "update uniattend.institutions set status = 'suspended' where id = $1", [id.instA]))
      .rejects.toThrow(/platform administrator/);
  });

  it("a student cannot grant themselves a role", async () => {
    await expect(db.as(u.sA1, "insert into uniattend.user_roles (user_id, institution_id, role) values ($1, $2, 'institution_admin')", [u.sA1, id.instA]))
      .rejects.toThrow(/row-level security/);
    await expect(db.as(u.sA1, "select uniattend.grant_role($1, 'sA1@uniA.ac.za', 'institution_admin')", [id.instA]))
      .rejects.toThrow(/institution admin only/);
  });
});

describe("tenant isolation (Institution A vs Institution B)", () => {
  it("admin A sees only A's students", async () => {
    const rows = await db.as<{ institution_id: string }>(u.adminA, "select institution_id from uniattend.students");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.institution_id === id.instA)).toBe(true);
  });

  it("admin A cannot read B's institution, modules, venues, lecturers or audit log", async () => {
    for (const t of ["institutions", "modules", "venues", "lecturers", "audit_logs", "institution_subscriptions"]) {
      const rows = await db.as(u.adminA, `select * from uniattend.${t} where ${t === "institutions" ? "id" : "institution_id"} = $1`, [id.instB]);
      expect(rows, t).toHaveLength(0);
    }
  });

  it("admin A cannot write into B", async () => {
    await expect(db.as(u.adminA, "insert into uniattend.faculties (institution_id, name, code) values ($1, 'X', 'X')", [id.instB]))
      .rejects.toThrow(/row-level security/);
    const upd = await db.as(u.adminA, "update uniattend.modules set title = 'pwned' where institution_id = $1 returning id", [id.instB]);
    expect(upd).toHaveLength(0);
    await expect(db.as(u.adminA, "select uniattend.import_students($1, '[]')", [id.instB])).rejects.toThrow(/admin only/);
  });

  it("a row in A cannot reference B's parent even with a forged id", async () => {
    await expect(db.as(u.adminA,
      "insert into uniattend.modules (institution_id, department_id, code, title) values ($1, $2, 'X1', 'Cross')",
      [id.instA, id.depB])).rejects.toThrow(/foreign key/);
  });

  it("student A sees only their own student row and A's modules", async () => {
    const st = await db.as<{ student_number: string }>(u.sA1, "select student_number from uniattend.students");
    expect(st.map((r) => r.student_number)).toEqual(["A001"]);
    const mods = await db.as(u.sA1, "select * from uniattend.modules where institution_id = $1", [id.instB]);
    expect(mods).toHaveLength(0);
  });

  it("lecturer A cannot open a session for B's module", async () => {
    await expect(db.as(u.lectA, "select uniattend.open_session($1, null, 'x')", [id.modB])).rejects.toThrow(/not your module/);
  });

  it("anon can read nothing and call nothing", async () => {
    expect(await db.as(null, "select * from uniattend.students")).toHaveLength(0);
    expect(await db.as(null, "select * from uniattend.institutions")).toHaveLength(0);
    await expect(db.as(null, "select uniattend.check_in(null, 'ABCDEF', null, null, null)")).rejects.toThrow(/permission denied/);
  });
});

describe("attendance engine", () => {
  let S: Awaited<ReturnType<typeof openSession>>;
  beforeAll(async () => { S = await openSession("A"); });

  it("session requires GPS because the venue is mapped", () => {
    expect(S.require_gps).toBe(true);
    expect(S.join_code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });

  it("students cannot read the QR signing secret or mint tokens", async () => {
    expect(await db.as(u.sA1, "select * from uniattend.session_secrets")).toHaveLength(0);
    await expect(db.as(u.sA1, "select uniattend.session_qr_token($1)", [S.id])).rejects.toThrow(/not your session/);
    await expect(db.as(u.sA1, "select uniattend.qr_sign($1, 1)", [S.id])).rejects.toThrow(/permission denied/);
  });

  it("valid QR + inside venue + device → present", async () => {
    const v = await checkIn(u.sA1, S.id, null, S.token, gpsAt(0), hex("a"));
    expect(v.outcome).toBe("accepted");
    expect(v.status).toBe("present");
    expect(v.score).toBe(100);
  });

  it("a second check-in is a duplicate and creates no second record", async () => {
    const v = await checkIn(u.sA1, S.id, null, S.token, gpsAt(0), hex("a"));
    expect(v.outcome).toBe("duplicate");
    const n = await db.admin<{ n: number }>("select count(*)::int n from uniattend.attendance_records where session_id = $1", [S.id]);
    expect(n[0].n).toBe(1);
  });

  it("forged and stale tokens are rejected and leave no record", async () => {
    const forged = S.token.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    expect((await checkIn(u.sA2, S.id, null, forged, gpsAt(0), hex("b"))).outcome).toBe("rejected");
    const [old] = await db.admin<{ t: string }>(
      "select (uniattend.qr_step() - 2)::text || '.' || uniattend.qr_sign($1, uniattend.qr_step() - 2) as t", [S.id]);
    const v = await checkIn(u.sA2, S.id, null, old.t, gpsAt(0), hex("b"));
    expect(v.outcome).toBe("rejected");
    expect(v.reasons.join(" ")).toMatch(/expired/);
    expect(await db.as(u.sA2, "select * from uniattend.attendance_records")).toHaveLength(0);
  });

  it("being 550 m away goes to review with an explanation — never straight to absent", async () => {
    const v = await checkIn(u.sA2, S.id, null, S.token, gpsAt(0.005), hex("b"));
    expect(v.outcome).toBe("review");
    expect(v.status).toBe("pending_verification");
    expect(v.reasons.join(" ")).toMatch(/outside the venue/);
  });

  it("a pending check-in can be improved by a better attempt", async () => {
    const v = await checkIn(u.sA2, S.id, null, S.token, gpsAt(0), hex("b"));
    expect(v.status).toBe("present");
  });

  it("one phone checking in a second student is flagged", async () => {
    const v = await checkIn(u.sA3, S.id, null, S.token, gpsAt(0), hex("a"));
    expect(v.reasons.join(" ")).toMatch(/already been used to check in another student/);
    expect(v.score).toBeLessThan(100);
  });

  it("students cannot write or change attendance directly", async () => {
    await expect(db.as(u.sA1, "update uniattend.attendance_records set status = 'excused' returning id"))
      .resolves.toHaveLength(0);
    await expect(db.as(u.sA1,
      "insert into uniattend.attendance_records (institution_id, session_id, module_id, student_id, status) select institution_id, session_id, module_id, student_id, 'present' from uniattend.attendance_records limit 1"))
      .rejects.toThrow(/row-level security/);
  });

  it("student B cannot check in to A's session even with A's live token", async () => {
    await expect(checkIn(u.sB1, S.id, null, S.token, gpsAt(0), hex("c"))).rejects.toThrow(/not registered as a student/);
  });

  it("every attempt is in the verification log", async () => {
    const n = await db.admin<{ n: number }>("select count(*)::int n from uniattend.attendance_verification_events where session_id = $1", [S.id]);
    expect(n[0].n).toBe(7);
  });
});

describe("closing, corrections, disputes, reports", () => {
  let S: Awaited<ReturnType<typeof openSession>>;
  beforeAll(async () => {
    S = await openSession("B");
    await checkIn(u.sB1, null, S.join_code, null, gpsAt(0), hex("1")); // typed code: lower score
    await checkIn(u.sB2, S.id, null, S.token, null, hex("2"));         // no GPS: review
  });

  it("typed code without GPS evidence is never auto-accepted at full score", async () => {
    const r = await db.as<{ status: string; score: number }>(u.sB1, "select status, score from uniattend.attendance_records");
    expect(r[0].score).toBeLessThan(100);
  });

  it("closing marks only the students who never checked in as absent", async () => {
    const res = await db.asOne<{ close_session: Record<string, number> }>(u.lectB, "select uniattend.close_session($1)", [S.id]);
    expect(res.close_session.absent).toBe(1);
    const recs = await db.as<{ student_number: string; status: string }>(u.lectB,
      "select s.student_number, a.status from uniattend.attendance_records a join uniattend.students s on s.id = a.student_id where a.session_id = $1 order by 1", [S.id]);
    expect(recs.find((r) => r.student_number === "B003")?.status).toBe("absent");
    expect(recs.find((r) => r.student_number === "B002")?.status).toBe("pending_verification");
  });

  it("lecturer correction requires a reason and is audited", async () => {
    const [b2] = await db.as<{ id: string }>(u.lectB, "select id from uniattend.students where student_number = 'B002'");
    await expect(db.as(u.lectB, "select uniattend.override_attendance($1, $2, 'present', '')", [S.id, b2.id])).rejects.toThrow(/reason/);
    await db.as(u.lectB, "select uniattend.override_attendance($1, $2, 'present', 'Seen in class, phone GPS off')", [S.id, b2.id]);
    const log = await db.as(u.adminB, "select * from uniattend.audit_logs where entity = 'attendance_records' and details->>'to' = 'present'");
    expect(log.length).toBeGreaterThan(0);
    expect(await db.as(u.adminA, "select * from uniattend.audit_logs where entity = 'attendance_records' and institution_id = $1", [id.instB])).toHaveLength(0);
  });

  it("student disputes an absence; lecturer upholds it", async () => {
    const [rec] = await db.as<{ id: string }>(u.sB3, "select id from uniattend.attendance_records where status = 'absent'");
    await expect(db.as(u.sB1, "select uniattend.submit_dispute($1, 'I was there honestly')", [rec.id])).rejects.toThrow(/not your attendance/);
    const d = await db.asOne<{ submit_dispute: string }>(u.sB3, "select uniattend.submit_dispute($1, 'I was in the back row, phone died')", [rec.id]);
    await db.as(u.lectB, "select uniattend.resolve_dispute($1, true, 'excused', 'Medical note')", [d.submit_dispute]);
    const [after] = await db.as<{ status: string }>(u.sB3, "select status from uniattend.attendance_records where id = $1", [rec.id]);
    expect(after.status).toBe("excused");
  });

  it("module report counts resolved sessions only", async () => {
    const rows = await db.as<{ student_number: string; percent: string | null; excused: number }>(u.lectB,
      "select * from uniattend.module_report($1)", [id.modB]);
    const by = Object.fromEntries(rows.map((r) => [r.student_number, r]));
    expect(Number(by.B002.percent)).toBe(100);
    expect(by.B003.percent).toBeNull(); // excused leaves the denominator
    await expect(db.as(u.sB1, "select * from uniattend.module_report($1)", [id.modB])).rejects.toThrow(/not your module/);
  });

  it("student sees their own summary", async () => {
    const rows = await db.as<{ code: string }>(u.sB2, "select * from uniattend.my_attendance()");
    expect(rows.map((r) => r.code)).toEqual(["CSC101"]);
  });
});

describe("late arrivals: the lecturer has the final say", () => {
  let S: Awaited<ReturnType<typeof openSession>>;
  const rec = async (user: string) => (await db.as<{ status: string; minutes_late: number | null }>(user,
    "select status, minutes_late from uniattend.attendance_records where session_id = $1", [S.id]))[0];
  const studentId = async (no: string) => (await db.as<{ id: string }>(u.lectA, "select id from uniattend.students where student_number = $1", [no]))[0].id;
  beforeAll(async () => {
    S = await openSession("A");
    // The grace period ended 17 minutes ago.
    await db.admin("update uniattend.class_sessions set late_after = now() - interval '17 minutes' where id = $1", [S.id]);
  });

  it("a student who arrives after the grace period is recorded grey (late_pending) with minutes late", async () => {
    const v = await checkIn(u.sA1, S.id, null, S.token, gpsAt(0), hex("d")) as Verdict & { minutes_late: number };
    expect(v.outcome).toBe("accepted");
    expect(v.status).toBe("late_pending");
    expect(v.minutes_late).toBe(17);
    expect(v.reasons.join(" ")).toMatch(/17 min after the grace period.*Location confirmed/);
    await checkIn(u.sA2, S.id, null, S.token, gpsAt(0), hex("e"));
    expect(await rec(u.sA2)).toEqual({ status: "late_pending", minutes_late: 17 });
  });

  it("a late arrival is not a duplicate-proof way around the lecturer", async () => {
    expect((await checkIn(u.sA1, S.id, null, S.token, gpsAt(0), hex("d"))).outcome).toBe("duplicate");
  });

  it("only the lecturer or an admin may decide", async () => {
    await expect(db.as(u.sA1, "select uniattend.decide_late($1, $2, true)", [S.id, [await studentId("A001")]]))
      .rejects.toThrow(/only the module lecturer/);
    await expect(db.as(u.lectB, "select uniattend.decide_late($1, $2, true)", [S.id, [await studentId("A001")]]))
      .rejects.toThrow(/only the module lecturer/);
  });

  it("denied → absent; the decision can be changed", async () => {
    const a2 = await studentId("A002");
    expect((await db.asOne<{ decide_late: number }>(u.lectA, "select uniattend.decide_late($1, $2, false)", [S.id, [a2]])).decide_late).toBe(1);
    expect((await rec(u.sA2)).status).toBe("absent");
    await db.as(u.lectA, "select uniattend.decide_late($1, $2, true)", [S.id, [a2]]);
    expect((await rec(u.sA2)).status).toBe("late");
    await db.as(u.lectA, "select uniattend.decide_late($1, $2, false, 'Arrived after the test started')", [S.id, [a2]]);
    expect((await rec(u.sA2)).status).toBe("absent");
  });

  it("decide_late never touches on-time records", async () => {
    // A003 has no record; A001 is pending. Only A001 changes.
    const n = (await db.asOne<{ decide_late: number }>(u.lectA, "select uniattend.decide_late($1, $2, true)",
      [S.id, [await studentId("A003")]])).decide_late;
    expect(n).toBe(0);
  });

  it("undecided late arrivals count as attended when the session closes", async () => {
    const res = await db.asOne<{ close_session: Record<string, number> }>(u.lectA, "select uniattend.close_session($1)", [S.id]);
    expect(res.close_session.late_auto_accepted).toBe(1);
    expect(await rec(u.sA1)).toEqual({ status: "late", minutes_late: 17 });
    expect((await rec(u.sA2)).status).toBe("absent");
  });
});

describe("commercial controls", () => {
  it("plan limits are enforced by the database", async () => {
    await db.as(u.super, "insert into uniattend.subscription_plans (code, name, max_students) values ('tiny', 'Tiny', 5)");
    await db.as(u.super, "select uniattend.change_subscription($1, 'tiny', 'active', now() + interval '1 year')", [id.instA]);
    const rows = [1, 2, 3].map((n) => ({ student_number: `AX${n}`, full_name: `Extra ${n}` }));
    await expect(db.as(u.adminA, "select uniattend.import_students($1, $2)", [id.instA, JSON.stringify(rows)]))
      .rejects.toThrow(/plan limit reached/);
  });

  it("only the super admin can change plans or prices", async () => {
    const upd = await db.as(u.adminA, "update uniattend.subscription_plans set price_cents = 0 returning id");
    expect(upd).toHaveLength(0);
    await expect(db.as(u.adminA, "select uniattend.change_subscription($1, 'enterprise', 'active', now() + interval '9 years')", [id.instA]))
      .rejects.toThrow(/super admin only/);
  });

  it("a suspended institution cannot run attendance", async () => {
    await db.as(u.super, "select uniattend.set_institution_status($1, 'suspended')", [id.instA]);
    await expect(db.as(u.lectA, "select uniattend.open_session($1, null, 'x')", [id.modA])).rejects.toThrow(/not active/);
    await db.as(u.super, "select uniattend.set_institution_status($1, 'active')", [id.instA]);
  });

  it("import validates rows and reports errors per row", async () => {
    await db.as(u.super, "select uniattend.change_subscription($1, 'professional', 'active', now() + interval '1 year')", [id.instA]);
    const rows = [
      { student_number: "A200", full_name: "Good" },
      { student_number: "", full_name: "No number" },
      { student_number: "A201", full_name: "Bad email", email: "nope" },
      { student_number: "A202", full_name: "Bad module", module_code: "ZZZ999" },
    ];
    const r = await db.asOne<{ import_students: { inserted: number; errors: { row: number }[] } }>(u.adminA,
      "select uniattend.import_students($1, $2)", [id.instA, JSON.stringify(rows)]);
    expect(r.import_students.inserted).toBe(1);
    expect(r.import_students.errors.map((e) => e.row)).toEqual([2, 3, 4]);
  });
});

describe("timetables and the dashboard rollup", () => {
  it("admin adds slots; a venue cannot be double-booked", async () => {
    await db.as(u.adminA, `insert into uniattend.timetables (institution_id, module_id, venue_id, weekday, starts_at, ends_at)
                           values ($1, $2, $3, 1, '08:00', '10:00')`, [id.instA, id.modA, id.venueA]);
    await expect(db.as(u.adminA, `insert into uniattend.timetables (institution_id, module_id, venue_id, weekday, starts_at, ends_at)
                           values ($1, $2, $3, 1, '09:00', '11:00')`, [id.instA, id.modA, id.venueA]))
      .rejects.toThrow(/already booked on Monday from 08:00 to 10:00 for CSC101/);
    // back-to-back is fine, and so is the same time on another day
    await db.as(u.adminA, `insert into uniattend.timetables (institution_id, module_id, venue_id, weekday, starts_at, ends_at, kind)
                           values ($1, $2, $3, 1, '10:00', '11:00', 'tutorial'), ($1, $2, $3, 2, '08:00', '10:00', 'practical')`,
      [id.instA, id.modA, id.venueA]);
  });

  it("students see their module's timetable, not another institution's", async () => {
    const mine = await db.as<{ kind: string }>(u.sA1, "select kind from uniattend.timetables order by weekday, starts_at");
    expect(mine.map((r) => r.kind)).toEqual(["lecture", "tutorial", "practical"]);
    expect(await db.as(u.sB1, "select * from uniattend.timetables where institution_id = $1", [id.instA])).toHaveLength(0);
    await expect(db.as(u.sA1, `insert into uniattend.timetables (institution_id, module_id, weekday, starts_at, ends_at)
                               values ($1, $2, 3, '08:00', '09:00')`, [id.instA, id.modA])).rejects.toThrow(/row-level security/);
  });

  it("dashboard rollup returns today's figures for the admin's own institution only", async () => {
    const d = (await db.asOne<{ institution_dashboard: { today: { present: number }; daily: unknown[]; gps: { inside: number }; recent: unknown[] } }>(
      u.adminA, "select uniattend.institution_dashboard($1)", [id.instA])).institution_dashboard;
    expect(d.today.present).toBeGreaterThanOrEqual(2);
    expect(d.daily).toHaveLength(14);
    expect(d.gps.inside).toBeGreaterThanOrEqual(1);
    expect(d.recent.length).toBeGreaterThan(0);
    await expect(db.as(u.adminB, "select uniattend.institution_dashboard($1)", [id.instA])).rejects.toThrow(/admin only/);
    await expect(db.as(u.sA1, "select uniattend.institution_dashboard($1)", [id.instA])).rejects.toThrow(/admin only/);
  });
});

describe("institution setup by the platform administrator", () => {
  it("ships a directory of 14 institutions that only the super admin can see", async () => {
    const all = await db.as<{ name: string; timetable_source_type: string }>(u.super, "select name, timetable_source_type from uniattend.institution_directory order by name");
    expect(all).toHaveLength(14);
    expect(all.find((d) => d.name === "Tshwane University of Technology")?.timetable_source_type).toBe("pdf_links");
    expect(all.find((d) => d.name === "University of Venda")?.timetable_source_type).toBe("viewer_json");
    expect(await db.as(u.adminA, "select * from uniattend.institution_directory")).toHaveLength(0);
    await expect(db.as(u.adminA, "insert into uniattend.institution_directory (name) values ('Sneaky')")).rejects.toThrow(/row-level security/);
  });

  it("only the super admin can set where an institution's timetable is collected from", async () => {
    await expect(db.as(u.adminA, "update uniattend.institution_settings set timetable_source_type = 'pdf_url', timetable_source_url = 'https://evil.example/x.pdf' where institution_id = $1", [id.instA]))
      .rejects.toThrow(/platform administrator/);
    await db.as(u.super, "update uniattend.institution_settings set timetable_source_type = 'pdf_links', timetable_source_url = 'https://www.tut.ac.za/timetables' where institution_id = $1", [id.instA]);
    // other policy fields stay editable by the institution's own admin
    await db.as(u.adminA, "update uniattend.institution_settings set min_attendance_pct = 80 where institution_id = $1", [id.instA]);
    await expect(db.as(u.super, "update uniattend.institution_settings set timetable_source_url = 'http://insecure.example' where institution_id = $1", [id.instA]))
      .rejects.toThrow(/check constraint/);
  });

  it("stores campus outlines for the institution's maps", async () => {
    await db.as(u.super, `insert into uniattend.campuses (institution_id, name, town, lat, lng, zoom, outline, osm_ref)
      values ($1, 'Main campus', 'Town', -23.9, 29.7, 16, '[[-23.9,29.7],[-23.9,29.71],[-23.91,29.71]]', 'way/1')`, [id.instA]);
    const rows = await db.as<{ name: string }>(u.sA1, "select name from uniattend.campuses");
    expect(rows.map((r) => r.name)).toContain("Main campus");
    expect(await db.as(u.sB1, "select * from uniattend.campuses where institution_id = $1", [id.instA])).toHaveLength(0);
  });
});

describe("phone notifications", () => {
  const SECRET = "x".repeat(40);
  const sub = (n: number) => [`https://push.example.com/send/${n}`, "B".repeat(40), "a".repeat(16)];
  beforeAll(async () => {
    await db.as(u.super, "select uniattend.set_push_secret($1, 15)", [SECRET]);
    await db.as(u.sA1, "select uniattend.save_push_subscription($1, $2, $3, 'test')", sub(1));
    await db.as(u.sA2, "select uniattend.save_push_subscription($1, $2, $3, 'test', '{\"classes\": false}')", sub(2));
    await db.as(u.adminA, "update uniattend.institutions set theme = jsonb_build_object('header', jsonb_build_object('logoUrl', 'https://uni-a.example/logo.png', 'title', 'Uni A')) where id = $1", [id.instA]);
  });
  const claim = () => db.as<{ notification_id: string; kind: string; title: string; endpoint: string; logo_url: string | null; institution_name: string }>(
    null, "select * from uniattend.push_claim($1)", [SECRET]);

  it("only the secret holder can claim, and only a super admin sets the secret", async () => {
    await expect(db.as(null, "select * from uniattend.push_claim('wrong')")).rejects.toThrow(/not allowed/);
    await expect(db.as(u.adminA, "select uniattend.set_push_secret($1)", [SECRET])).rejects.toThrow(/super admin/);
    expect(await db.as(u.sA1, "select * from uniattend.push_config")).toHaveLength(0);
  });

  it("students see only their own devices", async () => {
    expect(await db.as(u.sA1, "select endpoint from uniattend.push_subscriptions")).toEqual([{ endpoint: sub(1)[0] }]);
  });

  it("an announcement reaches its audience, with the institution's logo", async () => {
    await claim(); // drain anything earlier tests queued
    await db.as(u.adminA, "insert into uniattend.announcements (institution_id, title, body, audience) values ($1, 'Campus closed Friday', 'Graduation day.', 'students')", [id.instA]);
    const rows = await claim();
    const ann = rows.filter((r) => r.kind === "announcement");
    expect(ann.map((r) => r.endpoint).sort()).toEqual([sub(1)[0], sub(2)[0]]);
    expect(ann[0]).toMatchObject({ title: "Campus closed Friday", logo_url: "https://uni-a.example/logo.png", institution_name: "Uni A" });
    expect(await db.as(u.lectA, "select * from uniattend.notifications where kind = 'announcement'")).toHaveLength(0);
    expect(await claim()).toHaveLength(0); // never sent twice
  });

  it("queues one reminder per student before a class, respecting each device's choice", async () => {
    const [{ ok }] = await db.admin<{ ok: boolean }>(
      "select ((now() at time zone 'Africa/Johannesburg') + interval '20 minutes')::date = (now() at time zone 'Africa/Johannesburg')::date as ok");
    if (!ok) return; // too close to midnight for a same-day class
    await db.admin(`insert into uniattend.timetables (institution_id, module_id, weekday, starts_at, ends_at)
      select $1, $2, extract(isodow from now() at time zone 'Africa/Johannesburg')::int,
             ((now() at time zone 'Africa/Johannesburg') + interval '10 minutes')::time(0),
             ((now() at time zone 'Africa/Johannesburg') + interval '11 minutes')::time(0)`, [id.instA, id.modA]);
    const rows = (await claim()).filter((r) => r.kind === "class_reminder");
    expect(rows.map((r) => r.endpoint)).toEqual([sub(1)[0]]); // A2 turned class reminders off
    expect(rows[0].title).toMatch(/^CSC101 starts at \d\d:\d\d$/);
    const queued = await db.admin<{ n: number }>("select count(*)::int n from uniattend.notifications where kind = 'class_reminder'");
    expect(queued[0].n).toBe(3); // all three A students get it in their inbox
    expect(await db.admin<{ n: number }>("select uniattend.queue_class_reminders(15) n")).toEqual([{ n: 0 }]); // no duplicates
  });

  it("a gone subscription can be forgotten by the sender", async () => {
    await db.as(null, "select uniattend.push_forget($1, $2)", [SECRET, sub(2)[0]]);
    expect(await db.as(u.sA2, "select * from uniattend.push_subscriptions")).toHaveLength(0);
  });
});

describe("the lecturer's register: statuses, bulk save, history", () => {
  let S: Awaited<ReturnType<typeof openSession>>;
  const studentId = async (no: string) => (await db.as<{ id: string }>(u.lectB, "select id from uniattend.students where student_number = $1", [no]))[0].id;
  const statusOf = async (no: string) => (await db.as<{ status: string; custom_status_id: string | null }>(u.lectB,
    "select a.status, a.custom_status_id from uniattend.attendance_records a join uniattend.students s on s.id = a.student_id where a.session_id = $1 and s.student_number = $2", [S.id, no]))[0];
  beforeAll(async () => { S = await openSession("B"); });

  it("every institution starts with a 'Left early' status; only admins can add more", async () => {
    const rows = await db.as<{ name: string; category: string }>(u.lectB, "select name, category from uniattend.attendance_statuses where institution_id = $1", [id.instB]);
    expect(rows).toEqual([{ name: "Left early", category: "present" }]);
    await expect(db.as(u.lectB, "insert into uniattend.attendance_statuses (institution_id, name, category) values ($1, 'Field trip', 'excused') returning id", [id.instB]))
      .rejects.toThrow(/row-level security/);
    await db.as(u.adminB, "insert into uniattend.attendance_statuses (institution_id, name, color, category) values ($1, 'Field trip', '#0891b2', 'excused')", [id.instB]);
    expect(await db.as(u.adminA, "select * from uniattend.attendance_statuses where institution_id = $1", [id.instB])).toHaveLength(0);
  });

  it("saves many students in one go and skips unchanged ones", async () => {
    const [b1, b2, b3] = [await studentId("B001"), await studentId("B002"), await studentId("B003")];
    const [{ id: trip }] = await db.as<{ id: string }>(u.lectB, "select id from uniattend.attendance_statuses where name = 'Field trip'");
    const entries = [{ student: b1, status: "present" }, { student: b2, status: "absent" }, { student: b3, status: "present", custom: trip }];
    const r = await db.asOne<{ save_register: { changed: number; unchanged: number } }>(u.lectB, "select uniattend.save_register($1, $2)", [S.id, JSON.stringify(entries)]);
    expect(r.save_register).toEqual({ changed: 3, unchanged: 0 });
    expect((await statusOf("B003"))).toEqual({ status: "excused", custom_status_id: trip }); // the custom status decides the category
    const again = await db.asOne<{ save_register: { changed: number; unchanged: number } }>(u.lectB, "select uniattend.save_register($1, $2)", [S.id, JSON.stringify(entries)]);
    expect(again.save_register).toEqual({ changed: 0, unchanged: 3 });
  });

  it("refuses students, other institutions' statuses and non-members", async () => {
    const b1 = await studentId("B001");
    await expect(db.as(u.sB1, "select uniattend.save_register($1, $2)", [S.id, JSON.stringify([{ student: b1, status: "present" }])]))
      .rejects.toThrow(/only the module lecturer/);
    await db.as(u.adminA, "insert into uniattend.attendance_statuses (institution_id, name, category) values ($1, 'Sports', 'excused')", [id.instA]);
    const [{ id: other }] = await db.admin<{ id: string }>("select id from uniattend.attendance_statuses where name = 'Sports'");
    await expect(db.as(u.lectB, "select uniattend.save_register($1, $2)", [S.id, JSON.stringify([{ student: b1, status: "present", custom: other }])]))
      .rejects.toThrow(/unknown attendance status/);
  });

  it("after closing, a correction needs a reason, and the history shows every step", async () => {
    await db.as(u.lectB, "select uniattend.close_session($1)", [S.id]);
    const b2 = await studentId("B002");
    await expect(db.as(u.lectB, "select uniattend.save_register($1, $2)", [S.id, JSON.stringify([{ student: b2, status: "present" }])]))
      .rejects.toThrow(/give a reason/);
    await db.as(u.lectB, "select uniattend.save_register($1, $2, 'Signed the paper register')", [S.id, JSON.stringify([{ student: b2, status: "present" }])]);
    const [rec] = await db.as<{ id: string }>(u.lectB, "select id from uniattend.attendance_records where session_id = $1 and student_id = $2", [S.id, b2]);
    const hist = await db.as<{ kind: string; summary: string; note: string | null }>(u.sB2, "select kind, summary, note from uniattend.record_history($1)", [rec.id]);
    expect(hist.map((h) => h.summary)).toEqual(["none → absent", "absent → present"]);
    expect(hist[1].note).toBe("Signed the paper register");
    await expect(db.as(u.sB1, "select * from uniattend.record_history($1)", [rec.id])).rejects.toThrow(/not allowed/);
    const notes = await db.as<{ title: string }>(u.sB2, "select title from uniattend.notifications where kind = 'attendance_corrected'");
    expect(notes.length).toBeGreaterThan(0);
  });
});

describe("check-in controls, printed QR, card scans and check-out", () => {
  let S: Awaited<ReturnType<typeof openSession>>;
  const ctl = (action: string, closes?: number, late?: number) =>
    db.asOne<{ session_control: Record<string, unknown> }>(u.lectA, "select uniattend.session_control($1, $2, $3, $4)", [S.id, action, closes ?? null, late ?? null]);
  const scan = async (code: string, dir = "in") =>
    (await db.asOne<{ scan_student: Record<string, unknown> }>(u.lectA, "select uniattend.scan_student($1, $2, $3)", [S.id, code, dir])).scan_student;
  beforeAll(async () => { S = await openSession("A"); });

  it("a printed QR works only once allowed, and regenerating cancels it", async () => {
    expect((await db.asOne<{ printed_qr_token: string | null }>(u.lectA, "select uniattend.printed_qr_token($1)", [S.id])).printed_qr_token).toBeNull();
    await ctl("printed_on");
    const { printed_qr_token: t } = await db.asOne<{ printed_qr_token: string }>(u.lectA, "select uniattend.printed_qr_token($1)", [S.id]);
    expect(t).toMatch(/^P\./);
    const v = await checkIn(u.sA1, S.id, null, t, gpsAt(0), hex("1"));
    expect(v.outcome).toBe("accepted");
    await ctl("regenerate");
    expect((await checkIn(u.sA2, S.id, null, t, gpsAt(0), hex("2"))).outcome).toBe("rejected");
    await expect(db.as(u.sA1, "select uniattend.printed_qr_token($1)", [S.id])).rejects.toThrow(/not your session/);
  });

  it("pausing stops check-ins and resuming restarts them", async () => {
    await ctl("pause");
    await expect(checkIn(u.sA2, null, S.join_code, null, gpsAt(0), hex("2"))).rejects.toThrow(/No open session|not accepting/);
    const r = await ctl("resume");
    expect(r.session_control.status).toBe("open");
  });

  it("a scanned student card checks the student in, once", async () => {
    expect(await scan(" a002 ")).toMatchObject({ outcome: "checked_in", status: "present", full_name: "Student A2" });
    expect(await scan("A002")).toMatchObject({ outcome: "duplicate" });
    expect(await scan("B001")).toMatchObject({ outcome: "unknown" }); // another institution's student
    expect(await scan("ZZZ999")).toMatchObject({ outcome: "unknown" });
    await expect(db.as(u.sA1, "select uniattend.scan_student($1, 'A003')", [S.id])).rejects.toThrow(/not your session/);
  });

  it("checking out early marks 'Left early' and keeps the time", async () => {
    const out = (await db.asOne<{ check_out: Record<string, unknown> }>(u.sA1, "select uniattend.check_out($1)", [S.id])).check_out;
    expect(out).toMatchObject({ outcome: "checked_out", left_early: true });
    const [rec] = await db.as<{ checked_out_at: string | null; name: string | null }>(u.lectA,
      `select a.checked_out_at, st.name from uniattend.attendance_records a left join uniattend.attendance_statuses st on st.id = a.custom_status_id
       join uniattend.students s on s.id = a.student_id where a.session_id = $1 and s.student_number = 'A001'`, [S.id]);
    expect(rec.checked_out_at).not.toBeNull();
    expect(rec.name).toBe("Left early");
    expect((await db.asOne<{ check_out: Record<string, unknown> }>(u.sA1, "select uniattend.check_out($1)", [S.id])).check_out.outcome).toBe("duplicate");
    expect(await scan("A002", "out")).toMatchObject({ outcome: "checked_out" });
  });
});

describe("targeted announcements and lecturer messages", () => {
  const SECRET = "x".repeat(40);
  const inbox = async (user: string) => (await db.as<{ title: string; kind: string }>(user,
    "select title, kind from uniattend.notifications where kind in ('announcement','class_update') order by created_at desc limit 1"))[0];

  it("a lecturer messages their module's students, with the module code and category", async () => {
    const n = await db.asOne<{ send_class_message: number }>(u.lectA,
      "select uniattend.send_class_message($1, 'venue_change', 'Moved to Hall 2', 'Today''s lecture is in Hall 2.')", [id.modA]);
    expect(n.send_class_message).toBe(3);
    expect(await inbox(u.sA1)).toEqual({ title: "Venue change: CSC101 · Moved to Hall 2", kind: "class_update" });
    expect((await inbox(u.sB1))?.title ?? "").not.toContain("Moved to Hall 2");
  });

  it("only the module's lecturers (or an admin) can message it", async () => {
    await expect(db.as(u.lectB, "select uniattend.send_class_message($1, 'announcement', 'Hello', 'Hi there')", [id.modA]))
      .rejects.toThrow(/only the module's lecturers/);
    await expect(db.as(u.sA1, "select uniattend.send_class_message($1, 'announcement', 'Hello', 'Hi there')", [id.modA]))
      .rejects.toThrow(/only the module's lecturers/);
  });

  it("admins can target one student, and others can't read it", async () => {
    const [a2] = await db.as<{ id: string }>(u.adminA, "select id from uniattend.students where student_number = 'A002'");
    await db.as(u.adminA, "insert into uniattend.announcements (institution_id, title, body, audience, target_kind, target_id, category) values ($1, 'Please see the dean', 'Monday 10:00.', 'all', 'student', $2, 'academic')", [id.instA, a2.id]);
    expect((await inbox(u.sA2)).title).toBe("Academic: Please see the dean");
    expect((await inbox(u.sA1)).title).not.toContain("dean");
    expect(await db.as(u.sA1, "select * from uniattend.announcements where target_kind <> 'all'")).toHaveLength(0);
  });

  it("a department announcement reaches its students and lecturers only", async () => {
    await db.as(u.adminA, "insert into uniattend.announcements (institution_id, title, body, audience, target_kind, target_id) values ($1, 'Department meeting', 'Thursday.', 'all', 'department', $2)", [id.instA, id.depA]);
    expect((await inbox(u.sA3)).title).toBe("Department meeting");
    expect((await inbox(u.lectA)).title).toBe("Department meeting");
    expect((await inbox(u.sB2))?.title ?? "").not.toBe("Department meeting");
  });

  it("refuses targets from another institution", async () => {
    await expect(db.as(u.adminA, "insert into uniattend.announcements (institution_id, title, body, target_kind, target_id) values ($1, 'x', 'y', 'module', $2)", [id.instA, id.modB]))
      .rejects.toThrow(/not part of this institution/);
  });

  it("class updates follow each device's class-reminder setting", async () => {
    await db.as(null, "select * from uniattend.push_claim($1)", [SECRET]); // drain
    await db.as(u.lectA, "select uniattend.send_class_message($1, 'class_cancelled', 'No lecture today', 'Sorry, I am ill.')", [id.modA]);
    const rows = await db.as<{ endpoint: string; kind: string }>(null, "select endpoint, kind from uniattend.push_claim($1)", [SECRET]);
    expect(rows.filter((r) => r.kind === "class_update").map((r) => r.endpoint)).toEqual(["https://push.example.com/send/1"]); // A2's device turned classes off earlier
  });
});

describe("design drafts, version history and sign-in branding", () => {
  const look = (primary: string) => JSON.stringify({ colors: { primary }, login: { headline: `Welcome ${primary}` }, menus: { student: [] } });

  it("a draft is private to the institution's admins and replaced, not duplicated", async () => {
    await db.as(u.adminA, "select uniattend.save_theme_draft($1, $2)", [id.instA, look("#111111")]);
    await db.as(u.adminA, "select uniattend.save_theme_draft($1, $2)", [id.instA, look("#222222")]);
    const drafts = await db.as<{ theme: { colors: { primary: string } } }>(u.adminA,
      "select theme from uniattend.theme_versions where status = 'draft'");
    expect(drafts.map((d) => d.theme.colors.primary)).toEqual(["#222222"]);
    expect(await db.as(u.sA1, "select * from uniattend.theme_versions")).toHaveLength(0);
    expect(await db.as(u.adminB, "select * from uniattend.theme_versions")).toHaveLength(0);
    const live = await db.asOne<{ theme: object }>(u.adminA, "select theme from uniattend.institutions where id = $1", [id.instA]);
    expect(JSON.stringify(live.theme)).not.toContain("#222222");
  });

  it("publishing makes it live, records a version and clears the draft", async () => {
    await db.as(u.adminA, "select uniattend.publish_theme($1, $2, 'Blue for open day')", [id.instA, look("#333333")]);
    const inst = await db.asOne<{ brand_primary: string }>(u.sA1, "select brand_primary from uniattend.institutions where id = $1", [id.instA]);
    expect(inst.brand_primary).toBe("#333333");
    await db.as(u.adminA, "select uniattend.publish_theme($1, $2)", [id.instA, look("#444444")]);
    const versions = await db.as<{ status: string; note: string | null }>(u.adminA,
      "select status, note from uniattend.theme_versions where institution_id = $1 order by created_at desc", [id.instA]);
    // (an earlier design, if the institution had one, is kept as "Design before version history")
    expect(versions.every((v) => v.status === "published")).toBe(true);
    expect(versions.slice(1).map((v) => v.note)).toEqual(expect.arrayContaining(["Blue for open day"]));
    expect(versions.length).toBeLessThanOrEqual(3);
    expect(await db.as(u.adminA, "select 1 from uniattend.theme_versions where status = 'draft'")).toHaveLength(0);
  });

  it("only the institution's own admins can draft or publish", async () => {
    await expect(db.as(u.adminB, "select uniattend.publish_theme($1, $2)", [id.instA, look("#555555")])).rejects.toThrow(/administrators/);
    await expect(db.as(u.lectA, "select uniattend.save_theme_draft($1, $2)", [id.instA, look("#555555")])).rejects.toThrow(/administrators/);
    await expect(db.as(u.sA1, "insert into uniattend.theme_versions (institution_id, status, theme) values ($1, 'published', '{}')", [id.instA]))
      .rejects.toThrow();
  });

  it("the sign-in page gets the name, logo, colours and welcome text without signing in, and nothing more", async () => {
    const b = (await db.asOne<{ public_branding: { name: string; theme: Record<string, unknown> } }>(null,
      "select uniattend.public_branding('uni-a')")).public_branding;
    expect(b.name).toBe("University A");
    expect(b.theme.login).toEqual({ headline: "Welcome #444444" });
    expect(b.theme.menus).toBeUndefined();
    const byId = (await db.asOne<{ public_branding: { slug: string } }>(null, "select uniattend.public_branding($1)", [id.instB])).public_branding;
    expect(byId.slug).toBe("uni-b");
    expect((await db.asOne<{ public_branding: unknown }>(null, "select uniattend.public_branding('nope')")).public_branding).toBeNull();
    expect(await db.as(null, "select * from uniattend.theme_versions")).toHaveLength(0);
  });
});

describe("check-ins made without signal", () => {
  type Off = { outcome: string; status: string; reasons: string[]; offline?: boolean };
  const offline = async (user: string, session: string | null, code: string | null, token: string | null, at: Date, device = hex("a")) =>
    (await db.asOne<{ check_in_offline: Off }>(user, "select uniattend.check_in_offline($1, $2, $3, $4, $5, $6)",
      [session, code, token, JSON.stringify(gpsAt(0)), device, at.toISOString()])).check_in_offline;
  let S: Awaited<ReturnType<typeof openSession>>;
  beforeAll(async () => { S = await openSession("B"); });

  it("goes to review, never straight to present, keeping the original time and the QR proof", async () => {
    const at = new Date(Date.now() - 30_000);
    const r = await offline(u.sB1, S.id, null, S.token, at);
    expect(r).toMatchObject({ outcome: "review", status: "pending_verification", offline: true });
    expect(r.reasons.join(" ")).toMatch(/without signal at .*sent at/);
    expect(r.reasons.join(" ")).toMatch(/QR code matches the one on screen/);
    const [rec] = await db.as<{ method: string; checked_in_at: string }>(u.sB1,
      "select method, checked_in_at from uniattend.attendance_records where session_id = $1", [S.id]);
    expect(rec.method).toBe("offline");
    expect(Math.abs(Date.parse(rec.checked_in_at) - at.getTime())).toBeLessThan(1000);
  });

  it("refuses times in the future, outside the session, or older than 48 hours", async () => {
    await expect(offline(u.sB2, S.id, null, S.token, new Date(Date.now() + 10 * 60_000))).rejects.toThrow(/future/);
    await expect(offline(u.sB2, S.id, null, S.token, new Date(Date.now() - 3 * 24 * 3600_000))).rejects.toThrow(/48 hours/);
    await expect(offline(u.sB2, S.id, null, S.token, new Date(Date.now() - 5 * 3600_000))).rejects.toThrow(/outside the time/);
  });

  it("a forged QR is flagged, and students outside the module can't use it", async () => {
    const r = await offline(u.sB2, S.id, null, `${S.token.split(".")[0]}.${"A".repeat(22)}`, new Date(), hex("b"));
    expect(r.reasons.join(" ")).toMatch(/not valid for this session/);
    await expect(offline(u.sA1, S.id, null, S.token, new Date())).rejects.toThrow(/not registered as a student|not enrolled/);
  });

  it("after the session closes: an automatic absence becomes a review, a lecturer's decision is kept", async () => {
    await db.as(u.lectB, "select uniattend.close_session($1)", [S.id]);
    const r = await offline(u.sB3, S.id, null, S.token, new Date(Date.now() - 60_000), hex("c"));
    expect(r.status).toBe("pending_verification");
    expect(r.reasons.join(" ")).toMatch(/could not be checked/);
    const [b3] = await db.as<{ id: string }>(u.lectB, "select id from uniattend.students where student_number = 'B003'");
    await db.as(u.lectB, "select uniattend.override_attendance($1, $2, 'absent', 'Was not in class')", [S.id, b3.id]);
    const again = await offline(u.sB3, S.id, null, S.token, new Date(Date.now() - 60_000), hex("c"));
    expect(again.outcome).toBe("duplicate");
    expect(again.reasons[0]).toMatch(/already recorded this session/);
  });
});

describe("nobody is added to an institution without approval, notice and a way out", () => {
  let rogue: string, instC: string;
  const rolesAt = (user: string, inst: string) =>
    db.as<{ role: string; status: string }>(user, "select role, status from uniattend.user_roles where user_id = auth.uid() and institution_id = $1", [inst]);

  beforeAll(async () => {
    rogue = await db.newUser("founder@fake-uni.example");
    instC = (await db.asOne<{ request_institution: string }>(rogue, "select uniattend.request_institution('Fake University', 'fake-uni')")).request_institution;
    // The (still pending) institution's admin lists a real lecturer of University A as theirs.
    await db.as(rogue, "insert into uniattend.lecturers (institution_id, staff_number, full_name, email) values ($1, 'X1', 'Borrowed', 'lectA@uniA.ac.za')", [instC]);
  });

  it("a pending institution can't attach someone's account, by email match or by granting a role", async () => {
    await db.as(u.lectA, "select uniattend.link_my_accounts()");
    expect(await rolesAt(u.lectA, instC)).toHaveLength(0);
    await expect(db.as(rogue, "select uniattend.grant_role($1, 'lectA@uniA.ac.za', 'lecturer')", [instC])).rejects.toThrow(/must be approved/);
  });

  it("once approved, the person is linked and told, and can leave; the institution can't add them back", async () => {
    await db.as(u.super, "select uniattend.set_institution_status($1, 'active')", [instC]);
    await db.as(u.lectA, "select uniattend.link_my_accounts()");
    expect(await rolesAt(u.lectA, instC)).toEqual([{ role: "lecturer", status: "active" }]);
    const [note] = await db.as<{ title: string }>(u.lectA, "select title from uniattend.notifications where kind = 'membership' order by created_at desc limit 1");
    expect(note.title).toBe("Added to Fake University");

    expect((await db.asOne<{ leave_institution: number }>(u.lectA, "select uniattend.leave_institution($1)", [instC])).leave_institution).toBe(1);
    expect(await rolesAt(u.lectA, instC)).toEqual([{ role: "lecturer", status: "suspended" }]);
    await expect(db.as(rogue, "select uniattend.grant_role($1, 'lectA@uniA.ac.za', 'lecturer')", [instC])).rejects.toThrow(/left your institution/);
    const [rid] = await db.as<{ id: string }>(rogue, "select id from uniattend.user_roles where institution_id = $1 and role = 'lecturer'", [instC]);
    await expect(db.as(rogue, "select uniattend.set_role_status($1, 'active')", [rid.id])).rejects.toThrow(/left your institution/);
    // Their real institution is untouched.
    expect(await rolesAt(u.lectA, id.instA)).toEqual([{ role: "lecturer", status: "active" }]);
  });

  it("an only administrator can't leave and strand the institution", async () => {
    await expect(db.as(rogue, "select uniattend.leave_institution($1)", [instC])).rejects.toThrow(/only administrator/);
  });
});

describe("invoicing by hand and warnings before access ends", () => {
  it("only the platform admin records a payment; it activates and extends, once per reference", async () => {
    await expect(db.as(u.adminA, "select uniattend.record_manual_payment($1, 1500000, 'INV-001', 12)", [id.instA])).rejects.toThrow(/super admin only/);
    const r = (await db.asOne<{ record_manual_payment: { active_until: string } }>(u.super,
      "select uniattend.record_manual_payment($1, 1500000, 'INV-001', 12)", [id.instA])).record_manual_payment;
    const days = (Date.parse(r.active_until) - Date.now()) / 86400_000;
    expect(days).toBeGreaterThan(360);
    await expect(db.as(u.super, "select uniattend.record_manual_payment($1, 1500000, 'INV-001', 12)", [id.instA])).rejects.toThrow(/already recorded/);
    // A second payment extends from the current end, not from today.
    const r2 = (await db.asOne<{ record_manual_payment: { active_until: string } }>(u.super,
      "select uniattend.record_manual_payment($1, 1500000, 'INV-002', 1)", [id.instA])).record_manual_payment;
    expect(Date.parse(r2.active_until)).toBeGreaterThan(Date.parse(r.active_until));
  });

  it("an institution's admins see their own subscription notice, nobody else does", async () => {
    const n = (await db.asOne<{ subscription_notice: { status: string; operating: boolean; days_left: number } }>(u.adminA,
      "select uniattend.subscription_notice($1)", [id.instA])).subscription_notice;
    expect(n).toMatchObject({ status: "active", operating: true });
    expect(n.days_left).toBeGreaterThan(360);
    expect((await db.asOne<{ subscription_notice: unknown }>(u.adminB, "select uniattend.subscription_notice($1)", [id.instA])).subscription_notice).toBeNull();
    expect((await db.asOne<{ subscription_notice: unknown }>(u.lectA, "select uniattend.subscription_notice($1)", [id.instA])).subscription_notice).toBeNull();
  });
});

describe("retention, access to your own data, and data requests", () => {
  it("old records are listed, then deleted only by the institution's own admin; other institutions are untouched", async () => {
    const S = await openSession("A");
    await checkIn(u.sA2, S.id, null, S.token, gpsAt(0), hex("e"));
    await db.as(u.lectA, "select uniattend.close_session($1)", [S.id]);
    // Pretend it happened four years ago (past the default three-year period).
    await db.admin("update uniattend.class_sessions set opens_at = now() - interval '4 years 2 hours', late_after = now() - interval '4 years 1 hour', closes_at = now() - interval '4 years', closed_at = now() - interval '4 years' where id = $1", [S.id]);
    const B = await db.asOne<{ n: number }>(u.adminB, "select count(*)::int n from uniattend.attendance_records");

    const p = (await db.asOne<{ retention_preview: { sessions: number; attendance_records: number; auto: boolean } }>(u.adminA,
      "select uniattend.retention_preview($1)", [id.instA])).retention_preview;
    expect(p.sessions).toBe(1);
    expect(p.attendance_records).toBeGreaterThanOrEqual(1);
    expect(p.auto).toBe(false);
    await expect(db.as(u.adminB, "select uniattend.apply_retention($1)", [id.instA])).rejects.toThrow(/institution admin only/);
    await expect(db.as(u.lectA, "select uniattend.apply_retention($1)", [id.instA])).rejects.toThrow(/institution admin only/);
    await expect(db.as(u.sA1, "select uniattend.run_retention()")).rejects.toThrow(/permission denied/);

    await db.as(u.adminA, "select uniattend.apply_retention($1)", [id.instA]);
    expect(await db.as(u.adminA, "select 1 from uniattend.class_sessions where id = $1", [S.id])).toHaveLength(0);
    expect(await db.as(u.adminA, "select 1 from uniattend.attendance_records where session_id = $1", [S.id])).toHaveLength(0);
    expect((await db.asOne<{ n: number }>(u.adminB, "select count(*)::int n from uniattend.attendance_records")).n).toBe(B.n);
    const [log] = await db.as<{ action: string }>(u.adminA, "select action from uniattend.audit_logs where action = 'retention_applied'");
    expect(log.action).toBe("retention_applied");
  });

  it("anyone can download what is held about them, and only about them", async () => {
    const S = await openSession("A");
    await checkIn(u.sA1, S.id, null, S.token, gpsAt(0), hex("f"));
    const d =(await db.asOne<{ my_personal_data: { account: { email: string }; student_records: { student_number: string; attendance: unknown[] | null }[] } }>(u.sA1,
      "select uniattend.my_personal_data()")).my_personal_data;
    expect(d.account.email.toLowerCase()).toBe("s1@unia.ac.za");
    expect(d.student_records.map((s) => s.student_number)).toEqual(["A001"]);
    expect((d.student_records[0].attendance ?? []).length).toBeGreaterThan(0);
    await expect(db.as(null, "select uniattend.my_personal_data()")).rejects.toThrow();
  });

  it("a request reaches the person's own institution admins, not others, and the answer reaches the person", async () => {
    const { request_data_action: rid } = await db.asOne<{ request_data_action: string }>(u.sA3,
      "select uniattend.request_data_action('correction', 'My surname is spelt wrong.')");
    expect(await db.as(u.adminA, "select 1 from uniattend.data_requests where id = $1", [rid])).toHaveLength(1);
    expect(await db.as(u.adminB, "select 1 from uniattend.data_requests where id = $1", [rid])).toHaveLength(0);
    expect(await db.as(u.sA1, "select 1 from uniattend.data_requests where id = $1", [rid])).toHaveLength(0);
    await expect(db.as(u.adminB, "select uniattend.answer_data_request($1, 'done', 'Fixed it.')", [rid])).rejects.toThrow(/not allowed/);
    await expect(db.as(u.adminA, "select uniattend.answer_data_request($1, 'done', '')", [rid])).rejects.toThrow(/Tell the person/);
    await db.as(u.adminA, "select uniattend.answer_data_request($1, 'done', 'Your surname is corrected.')", [rid]);
    const [n] = await db.as<{ title: string }>(u.sA3, "select title from uniattend.notifications where kind = 'data_request' order by created_at desc limit 1");
    expect(n.title).toBe("Your request: done");
  });
});

describe("automatic roster sync: Moodle/feed worker, API key and uploads", () => {
  const SECRET = "x".repeat(40);
  const roster = (people: object[], modules: object[] = [{ code: "CSC101", title: "Intro to CS" }], extra: object = {}) =>
    JSON.stringify({ modules, people, ...extra });
  const stu = (n: number, codes = ["CSC101"]) => ({ role: "student", number: `A9${String(n).padStart(2, "0")}`, full_name: `Synced ${n}`, email: `syn${n}@unia.ac.za`, module_codes: codes });
  const activeFrom = async (source: string) => (await db.asOne<{ n: number }>(u.adminA,
    "select count(*)::int n from uniattend.module_enrolments where source = $1 and status = 'active'", [source])).n;
  let apiId: string, apiKey: string, moodleId: string;

  beforeAll(async () => { await db.as(u.super, "select uniattend.set_push_secret($1, 15)", [SECRET]); });

  it("an admin's upload adds students, lecturers, enrolments and teaching assignments, and reports problems", async () => {
    const r = (await db.asOne<{ import_roster: Record<string, number> & { errors: { error: string }[]; unknown_modules: string[] } }>(u.adminA,
      "select uniattend.import_roster($1, $2)", [id.instA, roster([
        stu(1), stu(2, ["CSC101", "NOPE999"]),
        { role: "lecturer", number: "", full_name: "Dr New", email: "new.lect@unia.ac.za", module_codes: ["CSC101"] },
        { role: "student", number: "", full_name: "No Number", module_codes: ["CSC101"] },
      ])])).import_roster;
    expect(r).toMatchObject({ students_added: 2, lecturers_added: 1, enrolments_added: 2, assignments_added: 1, skipped: 1 });
    expect(r.unknown_modules).toEqual(["NOPE999"]);
    expect(r.errors[0].error).toMatch(/student number is missing/);
    // Running it again changes nothing.
    const again = (await db.asOne<{ import_roster: Record<string, number> }>(u.adminA, "select uniattend.import_roster($1, $2)",
      [id.instA, roster([stu(1), stu(2)])])).import_roster;
    expect(again).toMatchObject({ students_added: 0, students_updated: 0, enrolments_added: 0 });
    await expect(db.as(u.adminB, "select uniattend.import_roster($1, $2)", [id.instA, roster([stu(3)])])).rejects.toThrow(/institution admin only/);
    await expect(db.as(u.lectA, "select uniattend.import_roster($1, $2)", [id.instA, roster([stu(3)])])).rejects.toThrow(/institution admin only/);
  });

  it("connections belong to one institution and their tokens can't be read back by anyone", async () => {
    moodleId = (await db.asOne<{ save_integration: { id: string } }>(u.adminA,
      "select uniattend.save_integration($1, null, 'moodle', 'Campus Moodle', 'https://moodle.unia.ac.za', 'tok-secret-1234', $2, 'daily')",
      [id.instA, JSON.stringify({ drop_missing: true })])).save_integration.id;
    const made = (await db.asOne<{ save_integration: { id: string; api_key: string } }>(u.adminA,
      "select uniattend.save_integration($1, null, 'api', 'Student system', null, null, $2, null)",
      [id.instA, JSON.stringify({ drop_missing: true })])).save_integration;
    apiId = made.id; apiKey = made.api_key;
    expect(apiKey).toMatch(/^ua_[0-9a-f]{48}$/);
    expect(await db.as(u.adminA, "select 1 from uniattend.integrations")).toHaveLength(2);
    expect(await db.as(u.adminB, "select 1 from uniattend.integrations")).toHaveLength(0);
    expect(await db.as(u.lectA, "select 1 from uniattend.integrations")).toHaveLength(0);
    for (const who of [u.adminA, u.super, null]) {
      await expect(db.as(who, "select * from uniattend.integration_secrets")).rejects.toThrow(/permission denied/);
    }
    await expect(db.as(u.adminB, "select uniattend.integration_action($1, 'delete')", [moodleId])).rejects.toThrow(/institution admin only/);
    await expect(db.as(u.adminB, "select uniattend.save_integration($1, null, 'feed', 'x feed', 'https://x.example/r.csv', null, '{}', 'daily')", [id.instA]))
      .rejects.toThrow(/institution admin only/);
    await expect(db.as(u.adminA, "select uniattend.save_integration($1, null, 'feed', 'bad', 'http://insecure.example/r.csv', null, '{}', 'daily')", [id.instA]))
      .rejects.toThrow(/https/);
  });

  it("the institution's own system pushes a roster with its API key; a wrong key is refused", async () => {
    await expect(db.as(null, "select uniattend.roster_push('ua_wrong', $1)", [roster([stu(10)])])).rejects.toThrow(/not valid/);
    const r = (await db.asOne<{ roster_push: Record<string, number> }>(null, "select uniattend.roster_push($1, $2)",
      [apiKey, roster([stu(10), stu(11), stu(12)], undefined, { complete: true })])).roster_push;
    expect(r).toMatchObject({ students_added: 3, enrolments_added: 3 });
    expect(await activeFrom(apiId)).toBe(3);
    // Nothing reached University B.
    expect(await db.as(u.adminB, "select 1 from uniattend.students where student_number like 'A9%'")).toHaveLength(0);
  });

  it("a complete roster drops enrolments it created that are gone, but never hand-made ones, and holds back a mass removal", async () => {
    const before = await db.asOne<{ n: number }>(u.adminA, "select count(*)::int n from uniattend.module_enrolments where source is null and status = 'active'");
    const r = (await db.asOne<{ roster_push: Record<string, number> }>(null, "select uniattend.roster_push($1, $2)",
      [apiKey, roster([stu(10), stu(11)], undefined, { complete: true })])).roster_push;
    expect(r.enrolments_dropped).toBe(1);
    expect(await activeFrom(apiId)).toBe(2);
    expect((await db.asOne<{ n: number }>(u.adminA, "select count(*)::int n from uniattend.module_enrolments where source is null and status = 'active'")).n).toBe(before.n);
    // An empty roster looks like a broken source: nothing is dropped.
    const empty = (await db.asOne<{ roster_push: Record<string, number> }>(null, "select uniattend.roster_push($1, $2)",
      [apiKey, roster([], undefined, { complete: true })])).roster_push;
    expect(empty).toMatchObject({ enrolments_dropped: 0, held_back: 2 });
    expect(await activeFrom(apiId)).toBe(2);
    // The student who came back is enrolled again.
    await db.as(null, "select uniattend.roster_push($1, $2)", [apiKey, roster([stu(10), stu(11), stu(12)], undefined, { complete: true })]);
    expect(await activeFrom(apiId)).toBe(3);
  });

  it("the worker needs the dispatch secret, gets the token, resumes where it stopped and records the run", async () => {
    await expect(db.as(null, "select uniattend.integration_claim('nope')")).rejects.toThrow(/not allowed/);
    await db.as(u.adminA, "select uniattend.integration_action($1, 'sync')", [moodleId]);
    const job = (await db.asOne<{ integration_claim: { id: string; token: string; run_id: string; cursor: number } }>(null,
      "select uniattend.integration_claim($1)", [SECRET])).integration_claim;
    expect(job).toMatchObject({ id: moodleId, token: "tok-secret-1234", cursor: 0 });
    // While one worker has it, another gets nothing.
    expect((await db.asOne<{ integration_claim: unknown }>(null, "select uniattend.integration_claim($1)", [SECRET])).integration_claim).toBeNull();
    await db.as(null, "select uniattend.integration_apply($1, $2, $3, 1)", [SECRET, job.run_id, roster([stu(20), stu(21)])]);
    await db.as(null, "select uniattend.integration_done($1, $2, 'later', null, false)", [SECRET, job.run_id]);
    const next = (await db.asOne<{ integration_claim: { run_id: string; cursor: number } }>(null, "select uniattend.integration_claim($1)", [SECRET])).integration_claim;
    expect(next).toMatchObject({ run_id: job.run_id, cursor: 1 });
    await db.as(null, "select uniattend.integration_apply($1, $2, $3, 2)", [SECRET, job.run_id, roster([stu(22)])]);
    await db.as(null, "select uniattend.integration_done($1, $2, 'ok', null, true)", [SECRET, job.run_id]);
    const [run] = await db.as<{ status: string; summary: { students_added: number; enrolments_added: number } }>(u.adminA,
      "select status, summary from uniattend.integration_runs where id = $1", [job.run_id]);
    expect(run.status).toBe("ok");
    expect(run.summary).toMatchObject({ students_added: 3, enrolments_added: 3 });
    const [it] = await db.as<{ last_status: string; next_due: boolean }>(u.adminA,
      "select last_status, next_run_at > now() + interval '23 hours' as next_due from uniattend.integrations where id = $1", [moodleId]);
    expect(it).toEqual({ last_status: "ok", next_due: true });
    expect((await db.asOne<{ integration_claim: unknown }>(null, "select uniattend.integration_claim($1)", [SECRET])).integration_claim).toBeNull();
  });

  it("a failed sync tells the admins and retries in an hour", async () => {
    await db.as(u.adminA, "select uniattend.integration_action($1, 'sync')", [moodleId]);
    const job = (await db.asOne<{ integration_claim: { run_id: string } }>(null, "select uniattend.integration_claim($1)", [SECRET])).integration_claim;
    await db.as(null, "select uniattend.integration_done($1, $2, 'failed', 'Moodle refused the token.', false)", [SECRET, job.run_id]);
    const [n] = await db.as<{ title: string; body: string }>(u.adminA, "select title, body from uniattend.notifications where kind = 'integration' order by created_at desc limit 1");
    expect(n.title).toBe("Campus Moodle: sync failed");
    expect(n.body).toMatch(/refused the token/);
  });

  it("a trial can import a full class list", async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ student_number: `B5${String(i).padStart(2, "0")}`, full_name: `Bulk ${i}`, module_code: "CSC101" }));
    const r = (await db.asOne<{ import_students: { inserted: number } }>(u.adminB, "select uniattend.import_students($1, $2)", [id.instB, JSON.stringify(many)])).import_students;
    expect(r.inserted).toBe(60);
  });
});

describe("sync engine: stage, preview, commit, external ids, two institutions", () => {
  const SECRET = "x".repeat(40);
  type Totals = { received: number; inserted: number; updated: number; unchanged: number; duplicates: number; rejected: number };
  type Result = Totals & { status?: string; datasets: Record<string, Totals & { dropped_missing?: number; held_back?: number }> };
  const J = (v: unknown) => JSON.stringify(v);
  const start = async (admin: string, inst: string, source = "its-export") =>
    (await db.asOne<{ import_start: string }>(admin, "select uniattend.import_start($1, $2, 'test file')", [inst, source])).import_start;
  const add = (admin: string, run: string, dataset: string, rows: object[]) => db.as(admin, "select uniattend.import_add($1, $2, $3)", [run, dataset, J(rows)]);
  const preview = async (admin: string, run: string) => (await db.asOne<{ import_preview: Result }>(admin, "select uniattend.import_preview($1)", [run])).import_preview;
  const commit = async (admin: string, run: string) => (await db.asOne<{ import_commit: Result }>(admin, "select uniattend.import_commit($1)", [run])).import_commit;

  const structure = [
    ["faculties", [{ external_id: "F1", code: "FSE", name: "Science and Engineering" }]],
    ["departments", [{ external_id: "D1", code: "CSE", name: "Computer Science", faculty_code: "FSE" }]],
    ["modules", [{ external_id: "M1", code: "CSE1541", title: "Programming 1", department_code: "CSE" },
                 { external_id: "M2", code: "CSE1542", title: "Data Structures", department_code: "CSE" }]],
    ["lecturers", [{ external_id: "L1", staff_number: "E1042", first_name: "Ndivhuwo", last_name: "Mudau", email: "n.mudau@unia.ac.za" }]],
    ["students", [{ external_id: "S1", student_number: "26000001", full_name: "Thabo Nkosi", email: "26000001@unia.ac.za", status: "Registered" },
                  { external_id: "S2", student_number: "26000002", full_name: "Lerato Dube", status: "active" }]],
    ["enrolments", [{ student_number: "26000001", module_code: "CSE1541" }, { student_external_id: "S2", module_external_id: "M1" },
                    { student_number: "26000001", module_code: "CSE1542" }]],
    ["assignments", [{ staff_number: "E1042", module_code: "CSE1541" }]],
  ] as const;

  beforeAll(async () => { await db.as(u.super, "select uniattend.set_push_secret($1, 15)", [SECRET]); });

  it("a preview counts everything and changes nothing; the commit applies it all", async () => {
    const run = await start(u.adminA, id.instA);
    for (const [ds, rows] of structure) await add(u.adminA, run, ds, rows as unknown as object[]);
    const p = await preview(u.adminA, run);
    expect(p).toMatchObject({ received: 11, inserted: 11, rejected: 0 });
    expect(p.datasets.enrolments).toMatchObject({ inserted: 3 });
    expect(await db.as(u.adminA, "select 1 from uniattend.students where student_number = '26000001'")).toHaveLength(0);
    const rows = await db.as<{ outcome: string }>(u.adminA, "select outcome from uniattend.integration_staging where run_id = $1", [run]);
    expect(rows.every((r) => r.outcome === "insert")).toBe(true);

    const c = await commit(u.adminA, run);
    expect(c).toMatchObject({ status: "ok", inserted: 11, rejected: 0 });
    const [s] = await db.as<{ full_name: string; status: string }>(u.adminA, "select full_name, status from uniattend.students where student_number = '26000001'");
    expect(s).toEqual({ full_name: "Thabo Nkosi", status: "active" });
    const [l] = await db.as<{ full_name: string }>(u.adminA, "select full_name from uniattend.lecturers where staff_number = 'E1042'");
    expect(l.full_name).toBe("Ndivhuwo Mudau");
    expect(await db.as(u.adminA, "select 1 from uniattend.integration_staging where run_id = $1", [run])).toHaveLength(0);
    await expect(commit(u.adminA, run)).rejects.toThrow(/already finished/);
  });

  it("importing the same data again creates nothing new", async () => {
    const run = await start(u.adminA, id.instA);
    for (const [ds, rows] of structure) await add(u.adminA, run, ds, rows as unknown as object[]);
    const c = await commit(u.adminA, run);
    expect(c).toMatchObject({ inserted: 0, updated: 0, unchanged: 11, rejected: 0 });
    expect((await db.asOne<{ n: number }>(u.adminA, "select count(*)::int n from uniattend.students where student_number like '26%'")).n).toBe(2);
  });

  it("the source's own id follows a renumbered student; a number clash is rejected, not merged", async () => {
    const run = await start(u.adminA, id.instA);
    await add(u.adminA, run, "students", [
      { external_id: "S1", student_number: "26000101", full_name: "Thabo Nkosi" },
      { external_id: "S2", student_number: "A001", full_name: "Lerato Dube" },
    ]);
    const c = await commit(u.adminA, run);
    expect(c).toMatchObject({ updated: 1, rejected: 1, status: "warnings" });
    expect(await db.as(u.adminA, "select 1 from uniattend.students where student_number = '26000101'")).toHaveLength(1);
    expect(await db.as(u.adminA, "select 1 from uniattend.students where student_number = '26000001'")).toHaveLength(0);
    const [e] = await db.as<{ message: string; ref: string }>(u.adminA, "select message, ref from uniattend.integration_errors where run_id = $1", [run]);
    expect(e).toEqual({ ref: "S2", message: "student number A001 already belongs to another student" });
  });

  it("status changes come only from an explicit status; history and enrolments stay", async () => {
    const run = await start(u.adminA, id.instA);
    await add(u.adminA, run, "students", [{ external_id: "S2", student_number: "26000002", full_name: "Lerato Dube", status: "Deregistered" }]);
    await add(u.adminA, run, "enrolments", [
      { student_number: "26000101", module_code: "CSE1542", status: "dropped" },
      { student_number: "26000002", module_code: "CSE1542" },          // a new module for a withdrawn student
    ]);
    const c = await commit(u.adminA, run);
    expect(c.datasets.students).toMatchObject({ updated: 1 });
    expect(c.datasets.enrolments).toMatchObject({ updated: 1, rejected: 1 });
    const [s] = await db.as<{ status: string }>(u.adminA, "select status from uniattend.students where student_number = '26000002'");
    expect(s.status).toBe("withdrawn");
    // Their existing enrolment is kept; the dropped one is marked, not deleted.
    const en = await db.as<{ code: string; status: string }>(u.adminA,
      "select m.code, e.status from uniattend.module_enrolments e join uniattend.modules m on m.id = e.module_id join uniattend.students s on s.id = e.student_id where s.student_number in ('26000002','26000101') order by 1, 2");
    expect(en).toEqual([{ code: "CSE1541", status: "active" }, { code: "CSE1541", status: "active" }, { code: "CSE1542", status: "dropped" }]);
    const [err] = await db.as<{ message: string }>(u.adminA, "select message from uniattend.integration_errors where run_id = $1", [run]);
    expect(err.message).toMatch(/is withdrawn, so they can't be enrolled/);
  });

  it("repeats in one file: identical ones are duplicates, conflicting ones are rejected; bad rows say why", async () => {
    const run = await start(u.adminA, id.instA);
    await add(u.adminA, run, "students", [
      { student_number: "26000201", full_name: "Ama Zulu" }, { student_number: "26000201", full_name: "Ama Zulu" },
      { student_number: "26000202", full_name: "Sipho M" }, { student_number: "26000202", full_name: "Sipho Mokoena" },
      { student_number: "", full_name: "No Number" }, { student_number: "26000203", full_name: "X", status: "on holiday" },
      { student_number: "26000204", full_name: "Y", email: "not-an-email" },
    ]);
    const p = await preview(u.adminA, run);
    expect(p).toMatchObject({ received: 7, inserted: 2, duplicates: 1, rejected: 4 });
    const errs = await db.as<{ row_no: number; error: string }>(u.adminA,
      "select row_no, error from uniattend.integration_staging where run_id = $1 and outcome = 'reject' order by row_no", [run]);
    expect(errs.map((e) => e.error)).toEqual([
      "appears more than once with different details (first at row 3)", "student_number is missing", 'unknown status "on holiday"', "email is not valid",
    ]);
    await db.as(u.adminA, "select uniattend.import_cancel($1)", [run]);
    expect(await db.as(u.adminA, "select 1 from uniattend.students where student_number = '26000201'")).toHaveLength(0);
  });

  it("the same student number and module code are separate records at each institution", async () => {
    const run = await start(u.adminB, id.instB);
    await add(u.adminB, run, "modules", [{ code: "CSE1541", title: "Intro to Programming (B)" }]);
    await add(u.adminB, run, "students", [{ external_id: "S1", student_number: "26000101", full_name: "A different person" }]);
    const c = await commit(u.adminB, run);
    expect(c).toMatchObject({ inserted: 2, rejected: 0 });
    const [a] = await db.as<{ full_name: string }>(u.adminA, "select full_name from uniattend.students where student_number = '26000101'");
    const [b] = await db.as<{ full_name: string }>(u.adminB, "select full_name from uniattend.students where student_number = '26000101'");
    expect([a.full_name, b.full_name]).toEqual(["Thabo Nkosi", "A different person"]);
  });

  it("another institution, a lecturer or a student can't see or touch an import", async () => {
    const run = await start(u.adminA, id.instA);
    await add(u.adminA, run, "students", [{ student_number: "26000301", full_name: "Private Person" }]);
    for (const who of [u.adminB, u.lectA, u.sA1]) {
      await expect(db.as(who, "select uniattend.import_preview($1)", [run])).rejects.toThrow(/institution admin only/);
      await expect(db.as(who, "select uniattend.import_commit($1)", [run])).rejects.toThrow(/institution admin only/);
      await expect(db.as(who, "select uniattend.import_add($1, 'students', '[]')", [run])).rejects.toThrow(/institution admin only/);
      expect(await db.as(who, "select 1 from uniattend.integration_staging where run_id = $1", [run])).toHaveLength(0);
      expect(await db.as(who, "select 1 from uniattend.integration_external_ids where institution_id = $1", [id.instA])).toHaveLength(0);
    }
    await expect(db.as(u.adminB, "select uniattend.import_start($1, 'x', 'x')", [id.instA])).rejects.toThrow(/institution admin only/);
    await expect(db.as(u.adminA, "insert into uniattend.integration_staging (run_id, institution_id, dataset, row_no, payload) values ($1, $2, 'students', 1, '{}')", [run, id.instA]))
      .rejects.toThrow(/permission denied/);
    await db.as(u.adminA, "select uniattend.import_cancel($1)", [run]);
  });

  it("a connection's worker stages, commits with checkpoints, reconciles a complete roster, and fails safely", async () => {
    const conn = (await db.asOne<{ save_integration: { id: string } }>(u.adminA,
      "select uniattend.save_integration($1, null, 'feed', 'Mock ITS (simulation)', 'https://sis.unia.example/roster.csv', null, '{}', 'daily')", [id.instA])).save_integration.id;
    await expect(db.as(null, "select uniattend.sync_begin('wrong', $1, 'full', 'manual')", [conn])).rejects.toThrow(/not allowed/);
    const begin = async () => (await db.asOne<{ sync_begin: { run_id: string; checkpoints: Record<string, string> } }>(null,
      "select uniattend.sync_begin($1, $2, 'full', 'manual')", [SECRET, conn])).sync_begin;

    const b1 = await begin();
    expect(b1.checkpoints).toEqual({});
    await db.as(null, "select uniattend.sync_stage($1, $2, 'enrolments', $3)", [SECRET, b1.run_id, J([
      { student_number: "A001", module_code: "CSE1541" }, { student_number: "A002", module_code: "CSE1541" }, { student_number: "A003", module_code: "CSE1541" },
    ])]);
    const c1 = (await db.asOne<{ sync_commit: Result }>(null, "select uniattend.sync_commit($1, $2, true, $3)", [SECRET, b1.run_id, J({ enrolments: "2026-11-14T02:00:00Z" })])).sync_commit;
    expect(c1.datasets.enrolments).toMatchObject({ inserted: 3, dropped_missing: 0 });
    expect((await begin()).checkpoints).toEqual({ enrolments: "2026-11-14T02:00:00Z" });

    // The next complete roster no longer lists A003: only the enrolment this connection made is dropped.
    const b2 = await begin();
    await db.as(null, "select uniattend.sync_stage($1, $2, 'enrolments', $3)", [SECRET, b2.run_id, J([
      { student_number: "A001", module_code: "CSE1541" }, { student_number: "A002", module_code: "CSE1541" },
    ])]);
    const c2 = (await db.asOne<{ sync_commit: Result }>(null, "select uniattend.sync_commit($1, $2, true, '{}')", [SECRET, b2.run_id])).sync_commit;
    expect(c2.datasets.enrolments).toMatchObject({ unchanged: 2, dropped_missing: 1 });
    // 26000101's hand-loaded (upload) enrolment in the same module was not touched.
    const [keep] = await db.as<{ status: string }>(u.adminA,
      "select e.status from uniattend.module_enrolments e join uniattend.students s on s.id = e.student_id join uniattend.modules m on m.id = e.module_id where s.student_number = '26000101' and m.code = 'CSE1541'");
    expect(keep.status).toBe("active");

    const b3 = await begin();
    await db.as(null, "select uniattend.sync_fail($1, $2, 'ITS answered 503.')", [SECRET, b3.run_id]);
    const [it] = await db.as<{ last_status: string; retry_soon: boolean }>(u.adminA,
      "select last_status, next_run_at < now() + interval '61 minutes' as retry_soon from uniattend.integrations where id = $1", [conn]);
    expect(it).toEqual({ last_status: "failed", retry_soon: true });
    await db.as(u.adminA, "select uniattend.retry_run($1)", [b3.run_id]);
    await expect(db.as(u.adminB, "select uniattend.retry_run($1)", [b3.run_id])).rejects.toThrow(/institution admin only/);
  });

  it("only a real test by the server can mark a connection connected", async () => {
    const [c] = await db.as<{ id: string; connection_status: string }>(u.adminA, "select id, connection_status from uniattend.integrations where name = 'Mock ITS (simulation)'");
    expect(c.connection_status).toBe("not_configured");
    await expect(db.as(u.adminA, "select uniattend.integration_test_result('guess', $1, 'connected', 'trust me')", [c.id])).rejects.toThrow(/not allowed/);
    await expect(db.as(u.adminA, "update uniattend.integrations set connection_status = 'connected' where id = $1", [c.id])).rejects.toThrow(/permission denied/);
    await db.as(null, "select uniattend.integration_test_result($1, $2, 'auth_failed', 'The token was refused.')", [SECRET, c.id]);
    const [after] = await db.as<{ connection_status: string; last_test_message: string }>(u.adminA,
      "select connection_status, last_test_message from uniattend.integrations where id = $1", [c.id]);
    expect(after).toEqual({ connection_status: "auth_failed", last_test_message: "The token was refused." });
  });
});

describe("saved column matchings for imports", () => {
  const map = JSON.stringify({ student_number: { column: "STUDENT_NO" }, full_name: { column: "NAME" } });

  it("an institution's admins keep their own matchings; nobody else sees or changes them", async () => {
    await db.as(u.adminA, "insert into uniattend.integration_mappings (institution_id, dataset, name, mapping) values ($1, 'students', 'ITS export', $2)", [id.instA, map]);
    expect(await db.as(u.adminA, "select 1 from uniattend.integration_mappings")).toHaveLength(1);
    for (const who of [u.adminB, u.lectA, u.sA1]) {
      expect(await db.as(who, "select 1 from uniattend.integration_mappings")).toHaveLength(0);
      await expect(db.as(who, "insert into uniattend.integration_mappings (institution_id, dataset, name, mapping) values ($1, 'students', 'mine', $2)", [id.instA, map]))
        .rejects.toThrow(/row-level security/);
    }
    await db.as(u.adminB, "delete from uniattend.integration_mappings where institution_id = $1", [id.instA]);
    await db.as(u.adminB, "update uniattend.integration_mappings set name = 'taken' where institution_id = $1", [id.instA]);
    const [m] = await db.as<{ name: string }>(u.adminA, "select name from uniattend.integration_mappings");
    expect(m.name).toBe("ITS export");
    // An admin can't move a matching into another institution.
    await expect(db.as(u.adminA, "update uniattend.integration_mappings set institution_id = $1 where institution_id = $2", [id.instB, id.instA]))
      .rejects.toThrow(/row-level security/);
    await expect(db.as(null, "select 1 from uniattend.integration_mappings")).rejects.toThrow(/permission denied/);
  });
});

describe("classes from the timetable and sessions prepared from them", () => {
  type Ev = { id: string; starts_at: string; status: string; venue_id: string | null; requires_attendance: boolean; edited: boolean; group_name: string | null };
  let slot: string, venue2: string, subUser: string, subLect: string;
  const events = (who: string) => db.as<Ev>(who, "select id, starts_at, status, venue_id, requires_attendance, edited, group_name from uniattend.timetable_events where timetable_id = $1 order by starts_at", [slot]);
  const gen = async () => (await db.asOne<{ generate_timetable_events: { created: number; updated: number; cancelled: number } }>(u.adminA,
    "select uniattend.generate_timetable_events($1, 14)", [id.instA])).generate_timetable_events;
  // An event happening now, made the way a timetable system would send it.
  const nowEvent = async (group: string | null = null) => (await db.admin<{ id: string }>(
    "insert into uniattend.timetable_events (institution_id, module_id, venue_id, kind, group_name, starts_at, ends_at, source) values ($1, $2, $3, 'lecture', $4, now() - interval '5 minutes', now() + interval '55 minutes', 'manual') returning id",
    [id.instA, id.modA, id.venueA, group]))[0].id;

  beforeAll(async () => {
    // Tomorrow (in South Africa) at 06:10, every week: an hour no other test books, whatever day tomorrow is.
    const [{ dow }] = await db.admin<{ dow: number }>("select extract(isodow from (now() at time zone 'Africa/Johannesburg')::date + 1)::int dow");
    slot = (await db.asOne<{ id: string }>(u.adminA,
      "insert into uniattend.timetables (institution_id, module_id, venue_id, weekday, starts_at, ends_at, kind) values ($1, $2, $3, $4, '06:10', '07:10', 'lecture') returning id",
      [id.instA, id.modA, id.venueA, dow])).id;
    venue2 = (await db.asOne<{ id: string }>(u.adminA, "insert into uniattend.venues (institution_id, name) values ($1, 'Hall 2') returning id", [id.instA])).id;
    subUser = await db.newUser("sub@unia.ac.za");
    subLect = (await db.asOne<{ id: string }>(u.adminA, "insert into uniattend.lecturers (institution_id, staff_number, full_name, email) values ($1, 'SUB1', 'Dr Substitute', 'sub@unia.ac.za') returning id", [id.instA])).id;
    await db.as(subUser, "select uniattend.link_my_accounts()");
  });

  it("the weekly timetable becomes dated classes, once, visible only to the right people", async () => {
    await gen();
    // Repeating changes nothing at all: no new classes, and none rewritten.
    expect(await gen()).toMatchObject({ created: 0, updated: 0, cancelled: 0 });
    const list = await events(u.adminA);
    expect(list).toHaveLength(2);
    expect(list.every((e) => e.requires_attendance && e.status === "scheduled")).toBe(true);
    expect(new Date(list[0].starts_at).toLocaleTimeString("en-ZA", { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit" })).toBe("06:10");
    expect(await events(u.sA1)).toHaveLength(2);       // enrolled student
    expect(await events(u.lectA)).toHaveLength(2);     // module lecturer
    expect(await events(u.sB1)).toHaveLength(0);
    expect(await events(u.lectB)).toHaveLength(0);
    expect(await events(u.adminB)).toHaveLength(0);
    await expect(db.as(u.adminB, "select uniattend.generate_timetable_events($1, 14)", [id.instA])).rejects.toThrow(/institution admin only/);
  });

  it("untouched classes follow the weekly slot; one changed by hand keeps its change", async () => {
    const [first, second] = await events(u.adminA);
    await db.as(u.lectA, "select uniattend.change_event($1, 'cancel', null, null, null, null, 'Public holiday')", [first.id]);
    await db.as(u.adminA, "update uniattend.timetables set venue_id = $1, starts_at = '07:20', ends_at = '08:20' where id = $2", [venue2, slot]);
    const r = await gen();
    expect(r.created).toBe(0);
    const [a, b] = await db.as<Ev>(u.adminA, "select id, starts_at, status, venue_id, edited from uniattend.timetable_events where id in ($1, $2) order by starts_at", [first.id, second.id]);
    expect(a).toMatchObject({ status: "cancelled", venue_id: id.venueA, edited: true });
    expect(b).toMatchObject({ status: "scheduled", venue_id: venue2, edited: false });
    expect(new Date(b.starts_at).toLocaleTimeString("en-ZA", { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit" })).toBe("07:20");
    expect(await events(u.adminA)).toHaveLength(2);    // moved, not duplicated
  });

  it("which kinds take attendance is the institution's choice", async () => {
    await db.as(u.adminA, "select uniattend.set_attendance_kinds($1, $2)", [id.instA, ["tutorial", "practical"]]);
    const list = await events(u.adminA);
    expect(list.find((e) => !e.edited)!.requires_attendance).toBe(false);
    await db.as(u.adminA, "select uniattend.set_attendance_kinds($1, $2)", [id.instA, ["lecture", "tutorial", "practical"]]);
    await expect(db.as(u.adminA, "select uniattend.set_attendance_kinds($1, $2)", [id.instA, ["party"]])).rejects.toThrow(/unknown kind/);
    await expect(db.as(u.lectA, "select uniattend.set_attendance_kinds($1, $2)", [id.instA, ["lecture"]])).rejects.toThrow(/institution admin only/);
  });

  it("'Open attendance' opens one session for the class, only in its time, for its lecturers", async () => {
    const future = (await events(u.adminA)).find((e) => e.status === "scheduled")!;
    await expect(db.as(u.lectA, "select uniattend.open_event_session($1)", [future.id])).rejects.toThrow(/opens 30 minutes before/);
    const ev = await nowEvent("A");
    await expect(db.as(u.lectB, "select uniattend.open_event_session($1)", [ev])).rejects.toThrow(/not your class/);
    await expect(db.as(u.sA1, "select uniattend.open_event_session($1)", [ev])).rejects.toThrow(/not your class/);
    const s1 = await db.asOne<{ id: string; group_name: string; event_id: string; status: string }>(u.lectA, "select id, group_name, event_id, status from uniattend.open_event_session($1)", [ev]);
    expect(s1).toMatchObject({ group_name: "A", event_id: ev, status: "open" });
    const s2 = await db.asOne<{ id: string }>(u.lectA, "select id from uniattend.open_event_session($1)", [ev]);
    expect(s2.id).toBe(s1.id);
    // The class can't be cancelled or moved while attendance is open.
    await expect(db.as(u.lectA, "select uniattend.change_event($1, 'cancel')", [ev])).rejects.toThrow(/Close the session/);
    // Students check in to it as to any session.
    const t = await db.asOne<{ session_qr_token: { token: string } }>(u.lectA, "select uniattend.session_qr_token($1)", [s1.id]);
    expect((await checkIn(u.sA1, s1.id, null, t.session_qr_token.token, gpsAt(0), hex("9"))).outcome).toBe("accepted");
    await db.as(u.lectA, "select uniattend.close_session($1)", [s1.id]);
  });

  it("a substitute can run the class they were given, and nothing else", async () => {
    const ev = await nowEvent();
    await expect(db.as(subUser, "select uniattend.open_event_session($1)", [ev])).rejects.toThrow(/not your class/);
    await db.as(u.lectA, "select uniattend.change_event($1, 'substitute', null, $2)", [ev, subLect]);
    const [n] = await db.as<{ title: string }>(subUser, "select title from uniattend.notifications where kind = 'class_update' order by created_at desc limit 1");
    expect(n.title).toMatch(/^You are teaching CSC101/);
    const s = await db.asOne<{ id: string }>(subUser, "select id from uniattend.open_event_session($1)", [ev]);
    expect(s.id).toBeTruthy();
    await expect(db.as(subUser, "select uniattend.change_event($1, 'cancel')", [ev])).rejects.toThrow(/module's lecturers or an administrator/);
    await expect(db.as(u.lectB, "select uniattend.change_event($1, 'substitute', null, $2)", [ev, subLect])).rejects.toThrow(/module's lecturers/);
    await db.as(u.lectA, "select uniattend.close_session($1)", [s.id]);
  });

  it("a change reaches the class's own group only", async () => {
    const [a1] = await db.as<{ id: string }>(u.adminA, "select id from uniattend.students where student_number = 'A001'");
    const [a2] = await db.as<{ id: string }>(u.adminA, "select id from uniattend.students where student_number = 'A002'");
    await db.admin("update uniattend.module_enrolments set group_name = 'A' where student_id = $1 and module_id = $2", [a1.id, id.modA]);
    await db.admin("update uniattend.module_enrolments set group_name = 'B' where student_id = $1 and module_id = $2", [a2.id, id.modA]);
    const ev = (await db.admin<{ id: string }>(
      "insert into uniattend.timetable_events (institution_id, module_id, venue_id, kind, group_name, starts_at, ends_at, source) values ($1, $2, $3, 'tutorial', 'A', now() + interval '2 days', now() + interval '2 days 1 hour', 'manual') returning id",
      [id.instA, id.modA, id.venueA]))[0].id;
    const r = (await db.asOne<{ change_event: { notified: number } }>(u.lectA, "select uniattend.change_event($1, 'venue', $2, null, null, null, 'Hall 1 is being painted.')", [ev, venue2])).change_event;
    expect(r.notified).toBeGreaterThanOrEqual(1);
    const latest = async (who: string) => (await db.as<{ title: string; body: string }>(who, "select title, body from uniattend.notifications where kind = 'class_update' order by created_at desc limit 1"))[0];
    expect((await latest(u.sA1)).body).toMatch(/Now in Hall 2\. Hall 1 is being painted\./);
    expect((await latest(u.sA2))?.body ?? "").not.toMatch(/Hall 1 is being painted/);
  });

  it("a timetable system's events sync by their own id: no duplicates, cancellations follow, bad rows are rejected alone", async () => {
    const day = (h: number) => { const d = new Date(Date.now() + 3 * 86400_000); return `${d.toISOString().slice(0, 10)} ${String(h).padStart(2, "0")}:00`; };
    const send = async (rows: object[]) => {
      const run = (await db.asOne<{ import_start: string }>(u.adminA, "select uniattend.import_start($1, 'celcat', 'events')", [id.instA])).import_start;
      await db.as(u.adminA, "select uniattend.import_add($1, 'timetable_events', $2)", [run, JSON.stringify(rows)]);
      return (await db.asOne<{ import_commit: { datasets: Record<string, Record<string, number>> } }>(u.adminA, "select uniattend.import_commit($1)", [run])).import_commit.datasets.timetable_events;
    };
    const ev = { external_id: "CEL-1", module_code: "CSC101", starts_at: day(8), ends_at: day(9), venue_name: "Hall 1", staff_number: "L1", kind: "lecture" };
    expect(await send([ev, { ...ev, external_id: "CEL-2", starts_at: "next Tuesday" }])).toMatchObject({ inserted: 1, rejected: 1 });
    expect(await send([ev])).toMatchObject({ unchanged: 1, inserted: 0 });
    expect(await send([{ ...ev, starts_at: day(9), ends_at: day(10) }])).toMatchObject({ updated: 1 });
    expect(await send([{ ...ev, starts_at: day(9), ends_at: day(10), status: "Cancelled" }])).toMatchObject({ updated: 1 });
    const [e] = await db.as<{ status: string; note: string; local: string }>(u.adminA,
      "select status, note, to_char(starts_at at time zone 'Africa/Johannesburg', 'HH24:MI') local from uniattend.timetable_events where external_id = 'CEL-1'");
    expect(e).toEqual({ status: "cancelled", note: "Cancelled in the timetable system.", local: "09:00" });
    expect(await db.as(u.adminA, "select 1 from uniattend.timetable_events where external_id like 'CEL-%'")).toHaveLength(1);
    expect(await db.as(u.adminB, "select 1 from uniattend.timetable_events where external_id like 'CEL-%'")).toHaveLength(0);
  });
});

describe("operations: migration record, health report, audited downloads", () => {
  const exportsBy = (who: string) => db.admin<{ institution_id: string | null; entity: string; entity_id: string | null; details: Record<string, unknown> }>(
    "select institution_id, entity, entity_id, details from uniattend.audit_logs where actor_id = $1 and action = 'export' order by id", [who]);

  it("records every migration, newest last, and only the platform administrator can read the list", async () => {
    const files = readdirSync(join(__dirname, "../../supabase/migrations")).filter((f) => f.endsWith(".sql")).map((f) => f.slice(0, 14)).sort();
    const rows = await db.admin<{ version: string }>("select version from uniattend.schema_versions order by version");
    expect(rows.map((r) => r.version)).toEqual(files);
    expect(await db.as(u.super, "select 1 from uniattend.schema_versions")).toHaveLength(files.length);
    expect(await db.as(u.adminA, "select 1 from uniattend.schema_versions")).toHaveLength(0);
  });

  it("the health report works for anyone and shows only the schema and job states", async () => {
    const r = (await db.asOne<{ health_report: Record<string, unknown> }>(null, "select uniattend.health_report()")).health_report;
    expect(Object.keys(r).sort()).toEqual(["failing_jobs", "jobs", "schema"]);
    expect(r.schema).toMatch(/^\d{14}$/);
    expect(r.failing_jobs).toEqual([]);   // no pg_cron in the test database: nothing to report
  });

  it("downloads are logged against the right institution, and only by people allowed to make them", async () => {
    await db.as(u.adminA, "select uniattend.log_export('admin_data', 42, $1, null, $2)", [id.instA, JSON.stringify({ kind: "students", archived: false, secret: "x" })]);
    await db.as(u.lectA, "select uniattend.log_export('module_report', 3, null, $1)", [id.modA]);
    await db.as(u.sA1, "select uniattend.log_export('personal_data', 1)");

    const a = await exportsBy(u.adminA);
    expect(a.at(-1)).toMatchObject({ institution_id: id.instA, entity: "admin_data", details: { rows: 42, kind: "students", archived: "false" } });
    expect(a.at(-1)!.details).not.toHaveProperty("secret");          // only known detail keys are kept
    expect((await exportsBy(u.lectA)).at(-1)).toMatchObject({ institution_id: id.instA, entity: "module_report", entity_id: id.modA });
    expect((await exportsBy(u.sA1)).at(-1)).toMatchObject({ institution_id: id.instA, entity: "personal_data" });

    // The institution's admin sees these in its audit log; the other institution does not.
    expect((await db.as(u.adminA, "select 1 from uniattend.audit_logs where action = 'export'")).length).toBeGreaterThanOrEqual(3);
    expect(await db.as(u.adminB, "select 1 from uniattend.audit_logs where action = 'export' and institution_id = $1", [id.instA])).toHaveLength(0);

    // Refused: another institution's data, a module someone does not teach, a student posing as admin, anonymous callers, made-up kinds.
    await expect(db.as(u.adminB, "select uniattend.log_export('admin_data', 1, $1)", [id.instA])).rejects.toThrow(/Not allowed/);
    await expect(db.as(u.lectB, "select uniattend.log_export('module_report', 1, null, $1)", [id.modA])).rejects.toThrow(/Not allowed/);
    await expect(db.as(u.sA1, "select uniattend.log_export('admin_data', 1, $1)", [id.instA])).rejects.toThrow(/Not allowed/);
    await expect(db.as(null, "select uniattend.log_export('personal_data', 1)")).rejects.toThrow(/permission denied/);
    await expect(db.as(u.adminA, "select uniattend.log_export('everything', 1, $1)", [id.instA])).rejects.toThrow(/Unknown export/);
    // Nobody can write the audit log directly.
    await expect(db.as(u.adminA, "insert into uniattend.audit_logs (institution_id, action, entity) values ($1, 'export', 'x')", [id.instA])).rejects.toThrow();
  });
});

describe("attendance exceptions: one review queue, and no absence from weak evidence", () => {
  let S: Awaited<ReturnType<typeof openSession>>;
  type Item = { record_id: string; student_number: string; kind: string; status: string; reasons: string[]; evidence: Record<string, unknown> };
  const queue = async (who: string, state = "open", inst = id.instA) =>
    (await db.asOne<{ review_queue: Item[] }>(who, "select uniattend.review_queue($1, $2)", [inst, state])).review_queue
      .filter((x) => (x as unknown as { session_id: string }).session_id === S.id);
  const rec = async (no: string) => (await db.admin<{ id: string; status: string; method: string; explanation: string[] }>(
    "select r.id, r.status, r.method, r.explanation from uniattend.attendance_records r join uniattend.students s on s.id = r.student_id where r.session_id = $1 and s.student_number = $2", [S.id, no]))[0];
  const decide = (who: string, records: string[], status: string, note: string | null = null) =>
    db.asOne<{ decide_review: number }>(who, "select uniattend.decide_review($1, $2, $3)", [records, status, note]).then((r) => r.decide_review);

  beforeAll(async () => {
    S = await openSession("A");
    await checkIn(u.sA1, S.id, null, S.token, gpsAt(0.005), hex("7"));   // 550 m away: review
    await checkIn(u.sA2, S.id, null, "not-a-token", gpsAt(0), hex("8")); // refused: no record yet
  });

  it("lists weak check-ins with their evidence, for the module's lecturer and the institution's admin only", async () => {
    const mine = await queue(u.lectA);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ student_number: "A001", kind: "outside_venue", status: "pending_verification" });
    expect(mine[0].evidence).toMatchObject({ attempts: 1, refused_attempts: 0, location_required: true });
    expect(Number(mine[0].evidence.outside_by_m)).toBeGreaterThan(400);
    expect(await queue(u.adminA)).toHaveLength(1);
    await expect(queue(u.lectB)).rejects.toThrow(/Only lecturers and administrators/);
    await expect(queue(u.adminB)).rejects.toThrow(/Only lecturers and administrators/);
    await expect(queue(u.sA1)).rejects.toThrow(/Only lecturers and administrators/);
    // The other institution's admin sees nothing of A's in its own queue.
    expect(await queue(u.adminB, "open", id.instB)).toHaveLength(0);
  });

  it("closing the class sends a refused attempt to review instead of marking it absent", async () => {
    const res = await db.asOne<{ close_session: Record<string, number> }>(u.lectA, "select uniattend.close_session($1)", [S.id]);
    expect(res.close_session.sent_to_review).toBe(1);
    const a2 = await rec("A002");
    expect(a2).toMatchObject({ status: "pending_verification", method: "system" });
    expect(a2.explanation.join(" ")).toMatch(/Tried to check in at \d\d:\d\d.*Sent for review instead of being marked absent/);
    expect((await rec("A003")).status).toBe("absent");                  // never tried: absent as before
    const kinds = Object.fromEntries((await queue(u.lectA)).map((x) => [x.student_number, x.kind]));
    expect(kinds).toEqual({ A001: "outside_venue", A002: "refused_attempt" });
  });

  it("decisions need the right person, and a reason to record absent or excused", async () => {
    const [a1, a2] = [(await rec("A001")).id, (await rec("A002")).id];
    await expect(decide(u.lectB, [a1], "present")).rejects.toThrow(/Not allowed/);
    await expect(decide(u.sA1, [a1], "present")).rejects.toThrow(/Not allowed/);
    await expect(decide(u.lectA, [a1, (await rec("A003")).id, "00000000-0000-0000-0000-000000000000"], "present")).rejects.toThrow(/Not allowed/);
    await expect(decide(u.lectA, [a2], "absent")).rejects.toThrow(/Give a reason/);
    await expect(decide(u.lectA, [a2], "pending_verification")).rejects.toThrow(/Choose present/);
    expect((await rec("A001")).status).toBe("pending_verification");    // nothing changed
  });

  it("deciding records the status, the reviewer and the reason, tells the student, and can't be repeated", async () => {
    const [a1, a2, a3] = [(await rec("A001")).id, (await rec("A002")).id, (await rec("A003")).id];
    expect(await decide(u.lectA, [a1], "present")).toBe(1);
    expect(await decide(u.adminA, [a2], "absent", "Was not in the hall when the code was shown")).toBe(1);
    expect(await decide(u.lectA, [a1, a3], "late")).toBe(0);             // already decided, or never in review
    expect((await rec("A001")).status).toBe("present");
    expect((await rec("A002")).status).toBe("absent");
    expect((await rec("A003")).status).toBe("absent");
    expect(await queue(u.lectA)).toHaveLength(0);

    const decided = await queue(u.lectA, "decided") as unknown as { student_number: string; decision: string; previous: string; note: string; decided_by: string }[];
    expect(decided.map((d) => [d.student_number, d.decision, d.previous])).toEqual([["A002", "absent", "pending_verification"], ["A001", "present", "pending_verification"]]);
    expect(decided[0].note).toBe("Was not in the hall when the code was shown");
    expect(decided[1].note).toBe("Confirmed present after review.");
    expect(await db.as(u.sA2, "select 1 from uniattend.notifications where title = 'Check-in reviewed' and body like '%absent. You can dispute%'")).toHaveLength(1);
    expect(await db.as(u.adminA, "select 1 from uniattend.audit_logs where action = 'review_decide'")).toHaveLength(2);
  });

  it("lists timetable classes that ended without a register, to the right people only", async () => {
    const [ev] = await db.admin<{ id: string }>(
      "insert into uniattend.timetable_events (institution_id, module_id, venue_id, kind, starts_at, ends_at, source, requires_attendance) values ($1, $2, $3, 'lecture', now() - interval '3 hours', now() - interval '2 hours', 'manual', true) returning id",
      [id.instA, id.modA, id.venueA]);
    await db.admin("insert into uniattend.timetable_events (institution_id, module_id, venue_id, kind, starts_at, ends_at, source, requires_attendance) values ($1, $2, $3, 'test', now() - interval '6 hours', now() - interval '5 hours', 'manual', false)",
      [id.instA, id.modA, id.venueA]);
    const missing = async (who: string, inst = id.instA) =>
      (await db.asOne<{ missing_registers: { event_id: string; module_code: string }[] }>(who, "select uniattend.missing_registers($1)", [inst])).missing_registers.map((m) => m.event_id);
    expect(await missing(u.lectA)).toContain(ev.id);
    expect(await missing(u.adminA)).toContain(ev.id);
    expect((await missing(u.adminA)).length).toBe((await missing(u.lectA)).length); // the attendance-free test is not listed
    await expect(missing(u.adminB)).rejects.toThrow(/Only lecturers and administrators/);
    await expect(missing(u.sA1)).rejects.toThrow(/Only lecturers and administrators/);
    expect(await missing(u.adminB, id.instB)).not.toContain(ev.id);
  });
});

describe("staff roles: each sees and changes only what the role allows", () => {
  const s: Ids = {};      // staff user ids
  let his: string;        // a History module, outside the Science faculty
  let facSci: string, depHist: string;
  const count = async (who: string, sql: string, params: unknown[] = []) => (await db.as(who, sql, params)).length;
  const grant = (role: string, email: string, faculty: string | null = null, dept: string | null = null, by = u.adminA) =>
    db.as(by, "select uniattend.grant_role($1, $2, $3, $4, $5)", [id.instA, email, role, faculty, dept]);

  beforeAll(async () => {
    facSci = (await db.admin<{ id: string }>("select faculty_id as id from uniattend.departments where id = $1", [id.depA]))[0].id;
    const hum = await db.asOne<{ id: string }>(u.adminA, "insert into uniattend.faculties (institution_id, name, code) values ($1, 'Humanities', 'HUM') returning id", [id.instA]);
    depHist = (await db.asOne<{ id: string }>(u.adminA, "insert into uniattend.departments (institution_id, faculty_id, name, code) values ($1, $2, 'History', 'HIS') returning id", [id.instA, hum.id])).id;
    his = (await db.asOne<{ id: string }>(u.adminA, "insert into uniattend.modules (institution_id, department_id, code, title) values ($1, $2, 'HIS101', 'World History') returning id", [id.instA, depHist])).id;
    const a1 = (await db.admin<{ id: string }>("select id from uniattend.students where student_number = 'A001'"))[0].id;
    await db.as(u.adminA, "insert into uniattend.module_enrolments (institution_id, module_id, student_id) values ($1, $2, $3)", [id.instA, his, a1]);
    for (const k of ["fac", "dep", "officer", "integ", "auditor"]) s[k] = await db.newUser(`${k}@uniA.ac.za`);
    await grant("faculty_admin", "fac@uniA.ac.za", facSci);
    await grant("department_admin", "dep@uniA.ac.za", null, depHist);
    await grant("attendance_officer", "officer@uniA.ac.za");
    await grant("integration_admin", "integ@uniA.ac.za");
    await grant("auditor", "auditor@uniA.ac.za");
  });

  it("only an institution admin grants roles, and scoped roles need a scope in that institution", async () => {
    await expect(grant("faculty_admin", "fac@uniA.ac.za")).rejects.toThrow(/Choose one of your faculties/);
    const facB = (await db.admin<{ id: string }>("select faculty_id as id from uniattend.departments where id = $1", [id.depB]))[0].id;
    await expect(grant("faculty_admin", "fac@uniA.ac.za", facB)).rejects.toThrow(/Choose one of your faculties/);
    await expect(grant("department_admin", "dep@uniA.ac.za")).rejects.toThrow(/Choose one of your departments/);
    for (const by of [s.integ, s.officer, s.auditor, s.fac, u.lectA, u.sA1]) {
      await expect(grant("auditor", "fac@uniA.ac.za", null, null, by)).rejects.toThrow(/institution admin only/);
    }
    await expect(db.admin("insert into uniattend.user_roles (user_id, institution_id, role) values ($1, $2, 'faculty_admin')", [s.dep, id.instA])).rejects.toThrow();
    const roles = await db.as<{ role: string; scope_name: string | null }>(s.fac, "select role, scope_name from uniattend.my_roles()");
    expect(roles).toEqual([expect.objectContaining({ role: "faculty_admin", scope_name: "Science" })]);
  });

  it("faculty and department admins see their own modules' attendance, and nothing else", async () => {
    const recs = (who: string, mod: string) => count(who, "select 1 from uniattend.attendance_records where module_id = $1", [mod]);
    const enrol = (who: string, mod: string) => count(who, "select 1 from uniattend.module_enrolments where module_id = $1", [mod]);
    const all = await recs(u.adminA, id.modA);
    expect(all).toBeGreaterThan(0);
    expect(await recs(s.fac, id.modA)).toBe(all);
    expect(await enrol(s.fac, his)).toBe(0);
    expect(await recs(s.dep, id.modA)).toBe(0);
    expect(await enrol(s.dep, his)).toBe(1);
    expect(await count(s.dep, "select 1 from uniattend.students")).toBe(1);   // only History's one student
    const ov = async (who: string) => ((await db.asOne<{ scope_overview: { code: string }[] }>(who, "select uniattend.scope_overview($1)", [id.instA])).scope_overview).map((m) => m.code).sort();
    expect(await ov(s.fac)).toEqual(["CSC101"]);
    expect(await ov(s.dep)).toEqual(["HIS101"]);
    expect(await ov(s.officer)).toEqual(expect.arrayContaining(["CSC101", "HIS101"]));
    await expect(ov(u.sA1)).rejects.toThrow(/Not allowed/);
    await expect(ov(s.integ)).rejects.toThrow(/Not allowed/);
  });

  it("officers and auditors see the whole institution; the integration admin sees no attendance or students", async () => {
    const all = await count(u.adminA, "select 1 from uniattend.attendance_records");
    expect(await count(s.officer, "select 1 from uniattend.attendance_records")).toBe(all);
    expect(await count(s.auditor, "select 1 from uniattend.attendance_records")).toBe(all);
    expect(await count(s.integ, "select 1 from uniattend.attendance_records")).toBe(0);
    expect(await count(s.integ, "select 1 from uniattend.students")).toBe(0);
    expect(await count(s.integ, "select 1 from uniattend.modules where id = $1", [his])).toBe(1);   // structure is readable
    // Nobody here sees the other institution.
    for (const k of ["fac", "dep", "officer", "integ", "auditor"]) {
      expect(await count(s[k], "select 1 from uniattend.attendance_records where institution_id = $1", [id.instB])).toBe(0);
      expect(await count(s[k], "select 1 from uniattend.students where institution_id = $1", [id.instB])).toBe(0);
    }
  });

  it("officers and scoped admins correct attendance in scope; auditors never change anything", async () => {
    const [r] = await db.admin<{ session_id: string; student_id: string }>(
      "select session_id, student_id from uniattend.attendance_records where module_id = $1 and status = 'absent' limit 1", [id.modA]);
    const fix = (who: string, status: string) => db.as(who, "select uniattend.override_attendance($1, $2, $3, 'Medical certificate seen')", [r.session_id, r.student_id, status]);
    await fix(s.officer, "excused");
    await fix(s.fac, "absent");
    await expect(fix(s.dep, "present")).rejects.toThrow(/only the module lecturer/);
    await expect(fix(s.auditor, "present")).rejects.toThrow(/only the module lecturer/);
    await expect(fix(s.integ, "present")).rejects.toThrow(/only the module lecturer/);
    // The auditor can read the review queue and decisions, but not decide.
    await db.as(s.auditor, "select uniattend.review_queue($1, 'decided')", [id.instA]);
    const anyRec = (await db.admin<{ id: string }>("select id from uniattend.attendance_records where module_id = $1 limit 1", [id.modA]))[0].id;
    await expect(db.as(s.auditor, "select uniattend.decide_review($1, 'present')", [[anyRec]])).rejects.toThrow(/Not allowed/);
    await expect(db.as(s.integ, "select uniattend.review_queue($1)", [id.instA])).rejects.toThrow(/Only lecturers and administrators/);
    // No new role can write the tables directly: there is no write policy, so nothing changes.
    const before = await db.admin("select id, status from uniattend.attendance_records where module_id = $1 order by id", [id.modA]);
    for (const k of ["officer", "auditor", "fac"]) {
      expect(await db.as(s[k], "update uniattend.attendance_records set status = 'present' where module_id = $1 returning id", [id.modA])).toEqual([]);
    }
    expect(await db.admin("select id, status from uniattend.attendance_records where module_id = $1 order by id", [id.modA])).toEqual(before);
  });

  it("the auditor reads the audit log and who holds which role; others in these roles do not", async () => {
    expect(await count(s.auditor, "select 1 from uniattend.audit_logs where institution_id = $1", [id.instA])).toBeGreaterThan(0);
    expect(await count(s.auditor, "select 1 from uniattend.user_roles where institution_id = $1", [id.instA])).toBeGreaterThan(5);
    for (const k of ["officer", "fac", "integ"]) {
      expect(await count(s[k], "select 1 from uniattend.audit_logs")).toBe(0);
      expect(await count(s[k], "select 1 from uniattend.user_roles where user_id <> $1", [s[k]])).toBe(0);
    }
  });

  it("the integration admin runs imports; other staff roles cannot", async () => {
    const run = (await db.asOne<{ import_start: string }>(s.integ, "select uniattend.import_start($1, 'test', 'by the integration admin')", [id.instA])).import_start;
    expect(await count(s.integ, "select 1 from uniattend.integration_runs where id = $1", [run])).toBe(1);
    expect(await count(s.officer, "select 1 from uniattend.integration_runs")).toBe(0);
    for (const k of ["officer", "auditor", "fac"]) {
      await expect(db.as(s[k], "select uniattend.import_start($1, 'x', 'x')", [id.instA])).rejects.toThrow(/institution admin only/);
    }
    await expect(db.as(s.integ, "select uniattend.import_start($1, 'x', 'x')", [id.instB])).rejects.toThrow(/institution admin only/);
  });
});

describe("institutional reports: aggregated in the database, limited to what each person may see", () => {
  type Report = {
    from: string; to: string;
    totals: { modules: number; sessions: number; present: number; late: number; absent: number; excused: number; unresolved: number; rate: number | null };
    by_faculty: { name: string }[]; by_department: { name: string }[];
    by_module: { code: string; sessions: number; rate: number | null }[];
    trend: { week: string; rate: number | null }[];
    at_risk: { student_number: string; module_code: string; consecutive_absences: number; worst_case: number | null }[];
    missing_registers: number; open_disputes: number;
  };
  const staff = async (email: string) => (await db.admin<{ id: string }>("select id from auth.users where email = $1", [email]))[0].id;
  const report = async (who: string, opts: { from?: string; to?: string; faculty?: string; department?: string; module?: string } = {}, inst = id.instA) =>
    (await db.asOne<{ institution_report: Report }>(who, "select uniattend.institution_report($1, $2, $3, $4, $5, $6)",
      [inst, opts.from ?? null, opts.to ?? null, opts.faculty ?? null, opts.department ?? null, opts.module ?? null])).institution_report;

  beforeAll(async () => {
    // Three classes in a row that A003 misses: open and close them without A003 checking in.
    for (let i = 0; i < 3; i++) {
      const S = await openSession("A");
      await checkIn(u.sA1, S.id, null, S.token, gpsAt(0), hex("a"));
      await db.as(u.lectA, "select uniattend.close_session($1)", [S.id]);
    }
  });

  it("counts every record of the closed classes in the period, once", async () => {
    const r = await report(u.adminA);
    const [truth] = await db.admin<{ n: number }>(
      `select count(*)::int as n from uniattend.attendance_records a join uniattend.class_sessions cs on cs.id = a.session_id
        where cs.institution_id = $1 and cs.status = 'closed' and (cs.opens_at at time zone 'Africa/Johannesburg')::date between $2 and $3`,
      [id.instA, r.from, r.to]);
    const t = r.totals;
    expect(t.sessions).toBeGreaterThanOrEqual(3);
    expect(t.present + t.late + t.absent + t.excused + t.unresolved).toBe(truth.n);
    expect(t.rate).toBeCloseTo(100 * (t.present + t.late) / (t.present + t.late + t.absent), 1);
    expect(r.by_module.find((m) => m.code === "CSC101")?.sessions).toBeGreaterThanOrEqual(3);
    expect(r.trend.length).toBeGreaterThan(0);
  });

  it("flags students absent three classes in a row or below the required attendance", async () => {
    const r = await report(u.adminA);
    const a3 = r.at_risk.find((x) => x.student_number === "A003" && x.module_code === "CSC101");
    expect(a3?.consecutive_absences).toBeGreaterThanOrEqual(3);
    expect(r.at_risk.find((x) => x.student_number === "A001" && x.module_code === "CSC101" && x.consecutive_absences >= 3)).toBeUndefined();
  });

  it("each person sees only the modules they may see; filters narrow it further", async () => {
    const codes = (r: Report) => r.by_module.map((m) => m.code).sort();
    const depHist = (await db.admin<{ id: string }>("select id from uniattend.departments where name = 'History' and institution_id = $1", [id.instA]))[0].id;
    expect(codes(await report(u.adminA))).toEqual(expect.arrayContaining(["CSC101", "HIS101"]));
    expect(codes(await report(u.adminA, { department: depHist }))).toEqual(["HIS101"]);
    expect(codes(await report(await staff("fac@uniA.ac.za")))).toEqual(["CSC101"]);
    expect(codes(await report(await staff("dep@uniA.ac.za")))).toEqual(["HIS101"]);
    expect(codes(await report(u.lectA))).toEqual(["CSC101"]);
    expect(codes(await report(await staff("auditor@uniA.ac.za")))).toEqual(expect.arrayContaining(["CSC101", "HIS101"]));
    // A faculty admin asking for another faculty's department gets nothing, not its data.
    expect(codes(await report(await staff("fac@uniA.ac.za"), { department: depHist }))).toEqual([]);
  });

  it("refuses people without a reporting role and other institutions", async () => {
    await expect(report(u.sA1)).rejects.toThrow(/Not allowed/);
    await expect(report(await staff("integ@uniA.ac.za"))).rejects.toThrow(/Not allowed/);
    await expect(report(u.adminB)).rejects.toThrow(/Not allowed/);
    await expect(report(u.lectB)).rejects.toThrow(/Not allowed/);
    expect((await report(u.adminB, {}, id.instB)).by_module.map((m) => m.code)).not.toContain("HIS101");
  });

  it("checks the period", async () => {
    expect((await report(u.adminA, { from: "2030-01-01", to: "2030-01-31" })).totals.sessions).toBe(0);
    await expect(report(u.adminA, { from: "2026-03-01", to: "2026-02-01" })).rejects.toThrow(/end date is before/);
    await expect(report(u.adminA, { from: "2024-01-01", to: "2026-01-01" })).rejects.toThrow(/at most 400 days/);
  });

  it("report downloads are audited, by people who may report", async () => {
    await db.as(u.lectA, "select uniattend.log_export('institution_report', 12, $1, null, $2)", [id.instA, JSON.stringify({ format: "xlsx", from: "2026-11-01", to: "2026-11-15" })]);
    const [row] = await db.admin<{ details: Record<string, unknown> }>(
      "select details from uniattend.audit_logs where actor_id = $1 and entity = 'institution_report' order by id desc limit 1", [u.lectA]);
    expect(row.details).toMatchObject({ rows: 12, format: "xlsx", from: "2026-11-01" });
    await expect(db.as(await staff("integ@uniA.ac.za"), "select uniattend.log_export('institution_report', 1, $1)", [id.instA])).rejects.toThrow(/Not allowed/);
    await expect(db.as(u.sA1, "select uniattend.log_export('institution_report', 1, $1)", [id.instA])).rejects.toThrow(/Not allowed/);
  });
});

describe("onboarding to go-live, and leaving UniAttend", () => {
  type Step = { key: string; done: boolean; by: string; detail: string };
  const status = async (who: string, inst = id.instA) =>
    (await db.asOne<{ onboarding_status: { steps: Step[]; ready_for_go_live: boolean; live: boolean } }>(who, "select uniattend.onboarding_status($1)", [inst])).onboarding_status;
  const done = async (who: string, inst = id.instA) => Object.fromEntries((await status(who, inst)).steps.map((s) => [s.key, s.done]));
  const signOff = (who: string, step: string, note: string | null = null, undo = false, inst = id.instA) =>
    db.as(who, "select uniattend.onboarding_sign_off($1, $2, $3, $4)", [inst, step, note, undo]);

  it("has the same twelve steps for everyone; the data decides the automatic ones", async () => {
    const s = await status(u.adminA);
    expect(s.steps.map((x) => x.key)).toEqual(["registered", "verified", "approved", "admin", "structure", "integration", "people", "timetable", "policy", "pilot", "training", "go_live"]);
    expect(await done(u.adminA)).toMatchObject({ registered: true, approved: true, admin: true, structure: true, people: true, timetable: true, pilot: true,
      verified: false, policy: false, training: false, go_live: false });
    expect(s.ready_for_go_live).toBe(false);
    await expect(status(u.lectA)).rejects.toThrow(/Not allowed/);
    await expect(status(u.adminB)).rejects.toThrow(/Not allowed/);
  });

  it("only the right person signs each step off, and steps shown by the data cannot be ticked", async () => {
    await expect(signOff(u.adminA, "verified")).rejects.toThrow(/Only UniAttend/);
    await expect(signOff(u.adminA, "go_live")).rejects.toThrow(/Only UniAttend/);
    await expect(signOff(u.adminA, "structure")).rejects.toThrow(/worked out from your data/);
    await expect(signOff(u.lectA, "policy")).rejects.toThrow(/Not allowed/);
    await expect(signOff(u.adminB, "policy")).rejects.toThrow(/Not allowed/);
    await signOff(u.adminA, "policy");
    await signOff(u.adminA, "training", "Two sessions, 14 Nov");
    expect(await done(u.adminA)).toMatchObject({ policy: true, training: true });
    expect(await db.as(u.adminA, "select 1 from uniattend.audit_logs where action = 'onboarding_sign_off'")).toHaveLength(2);
  });

  it("go-live waits for every earlier step", async () => {
    // A brand-new connection or import counts for the data step; make sure there is one.
    const d = await done(u.adminA);
    if (!d.integration) await db.admin("insert into uniattend.integrations (institution_id, kind, name) values ($1, 'api', 'Test push')", [id.instA]);
    await expect(signOff(u.super, "go_live")).rejects.toThrow(/Not ready to go live. Still to do: Verification/);
    await signOff(u.super, "verified", "Registration letter and domain checked");
    await signOff(u.super, "go_live");
    expect((await status(u.adminA)).live).toBe(true);
    await signOff(u.super, "go_live", null, true);                    // can be undone, and is audited
    expect((await status(u.adminA)).live).toBe(false);
    const overview = (await db.asOne<{ onboarding_overview: { name: string; done: number; total: number }[] }>(u.super, "select uniattend.onboarding_overview()")).onboarding_overview;
    expect(overview.length).toBeGreaterThanOrEqual(2);
    await expect(db.as(u.adminA, "select uniattend.onboarding_overview()")).rejects.toThrow(/Not allowed/);
  });

  it("an institution asks to leave; the platform is told", async () => {
    await expect(db.as(u.adminB, "select uniattend.request_exit($1, 'no')", [id.instB])).rejects.toThrow(/Say briefly why/);
    await expect(db.as(u.lectB, "select uniattend.request_exit($1, 'We are leaving')", [id.instB])).rejects.toThrow(/own administrators/);
    await expect(db.as(u.adminA, "select uniattend.request_exit($1, 'We are leaving')", [id.instB])).rejects.toThrow(/own administrators/);
    await db.as(u.adminB, "select uniattend.request_exit($1, 'Moving to a system the university already licenses')", [id.instB]);
    await expect(db.as(u.adminB, "select uniattend.request_exit($1, 'Again please')", [id.instB])).rejects.toThrow(/already asked/);
    expect(await db.as(u.super, "select 1 from uniattend.notifications where kind = 'exit_requested'")).toHaveLength(1);
    const reqs = (await db.asOne<{ exit_requests: { institution_id: string; status: string }[] }>(u.super, "select uniattend.exit_requests()")).exit_requests;
    expect(reqs.find((r) => r.institution_id === id.instB)?.status).toBe("requested");
    expect(await db.as(u.adminA, "select 1 from uniattend.institution_exit_requests")).toHaveLength(0);   // not another institution's business
  });

  it("revoking credentials deletes every stored token and key and pauses the connections", async () => {
    const [g] = await db.admin<{ id: string }>("insert into uniattend.integrations (institution_id, kind, name, base_url) values ($1, 'feed', 'Roster link', 'https://sis.unib.ac.za/roster.csv') returning id", [id.instB]);
    await db.admin("insert into uniattend.integration_secrets (integration_id, token) values ($1, 'secret-token')", [g.id]);
    await expect(db.as(u.adminA, "select uniattend.revoke_integration_credentials($1)", [id.instB])).rejects.toThrow(/Not allowed/);
    expect((await db.asOne<{ revoke_integration_credentials: number }>(u.adminB, "select uniattend.revoke_integration_credentials($1)", [id.instB])).revoke_integration_credentials).toBeGreaterThanOrEqual(1);
    expect(await db.admin("select 1 from uniattend.integration_secrets s join uniattend.integrations g on g.id = s.integration_id where g.institution_id = $1", [id.instB])).toHaveLength(0);
    expect(await db.admin("select 1 from uniattend.integrations where institution_id = $1 and status <> 'paused'", [id.instB])).toHaveLength(0);
  });

  it("the full export is audited for admins only", async () => {
    await db.as(u.adminA, "select uniattend.log_export('institution_export', 5000, $1, null, $2)", [id.instA, JSON.stringify({ format: "zip" })]);
    await expect(db.as(u.lectA, "select uniattend.log_export('institution_export', 1, $1)", [id.instA])).rejects.toThrow(/Not allowed/);
    await expect(db.as(await (async () => (await db.admin<{ id: string }>("select id from auth.users where email = 'auditor@uniA.ac.za'"))[0].id)(),
      "select uniattend.log_export('institution_export', 1, $1)", [id.instA])).rejects.toThrow(/Not allowed/);
  });

  it("only the platform closes the account: archived, credentials gone, nothing deleted", async () => {
    const before = (await db.admin<{ n: number }>("select count(*)::int as n from uniattend.attendance_records where institution_id = $1", [id.instB]))[0].n;
    await expect(db.as(u.adminB, "select uniattend.close_institution($1, 'Agreed by email')", [id.instB])).rejects.toThrow(/Only UniAttend/);
    await expect(db.as(u.super, "select uniattend.close_institution($1, 'ok')", [id.instB])).rejects.toThrow(/Record how the closure was agreed/);
    await expect(db.as(u.super, "select uniattend.close_institution($1, 'Agreed by email')", [id.instA])).rejects.toThrow(/has not asked to leave/);
    await db.as(u.super, "select uniattend.close_institution($1, 'Agreed by email on 15 Nov; export downloaded')", [id.instB]);
    expect((await db.admin<{ status: string }>("select status from uniattend.institutions where id = $1", [id.instB]))[0].status).toBe("archived");
    expect((await db.admin<{ status: string }>("select status from uniattend.institution_exit_requests where institution_id = $1", [id.instB]))[0].status).toBe("closed");
    expect((await db.admin<{ n: number }>("select count(*)::int as n from uniattend.attendance_records where institution_id = $1", [id.instB]))[0].n).toBe(before);
  });
});

describe("institution API v1: safe retries, status and run results, one institution per key", () => {
  let key: string, otherKey: string;
  const body = (n: number) => ({ complete: false, modules: [{ code: "CSC101", title: "Intro to CS" }],
    people: [{ role: "student", number: `V1${String(n).padStart(3, "0")}`, full_name: `Api Student ${n}`, module_codes: ["CSC101"] }] });
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  const push = async (k: string, payload: object, idem: string | null = null, hash: string | null = null) =>
    (await db.asOne<{ api_roster_push: Record<string, unknown> }>(null, "select uniattend.api_roster_push($1, $2, $3, $4)",
      [k, JSON.stringify(payload), idem, idem ? hash ?? sha(JSON.stringify(payload)) : null])).api_roster_push;

  beforeAll(async () => {
    key = (await db.asOne<{ save_integration: { api_key: string } }>(u.adminA,
      "select uniattend.save_integration($1, null, 'api', 'SIS push v1', null, null, '{}', null)", [id.instA])).save_integration.api_key;
    await db.as(u.super, "select uniattend.set_institution_status($1, 'active')", [id.instB]);   // B was archived by the exit test
    otherKey = (await db.asOne<{ save_integration: { api_key: string } }>(u.adminB,
      "select uniattend.save_integration($1, null, 'api', 'B push', null, null, '{}', null)", [id.instB])).save_integration.api_key;
  });

  it("applies a roster and says which run did it", async () => {
    const r = await push(key, body(1));
    expect(r).toMatchObject({ students_added: 1, replayed: false, complete: false });
    expect(r.run_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("a retried request with the same Idempotency-Key returns the first answer and changes nothing", async () => {
    const first = await push(key, body(2), "retry-test-0001");
    const again = await push(key, body(2), "retry-test-0001");
    expect(again).toMatchObject({ ...first, replayed: true });
    const runs = await db.admin<{ n: number }>("select count(*)::int as n from uniattend.integration_runs where id = $1", [first.run_id]);
    expect(runs[0].n).toBe(1);
    await expect(push(key, body(3), "retry-test-0001")).rejects.toThrow(/already used with a different body/);
    await expect(push(key, body(3), "bad key!")).rejects.toThrow(/Idempotency-Key must be/);
    // The same key string under another connection is unrelated.
    expect((await push(otherKey, body(2), "retry-test-0001")).replayed).toBe(false);
  });

  it("status and run results show only this key's connection", async () => {
    const s = (await db.asOne<{ api_status: { institution: string; connection: string; recent_runs: { id: string }[] } }>(null,
      "select uniattend.api_status($1)", [key])).api_status;
    expect(s).toMatchObject({ connection: "SIS push v1", status: "active" });
    expect(s.recent_runs.length).toBeGreaterThanOrEqual(2);
    const runId = s.recent_runs[0].id;
    const run = (await db.asOne<{ api_run: { id: string; status: string } }>(null, "select uniattend.api_run($1, $2)", [key, runId])).api_run;
    expect(run).toMatchObject({ id: runId, status: "ok" });
    await expect(db.as(null, "select uniattend.api_run($1, $2)", [otherKey, runId])).rejects.toThrow(/No such run for this key/);
    await expect(db.as(null, "select uniattend.api_status('ua_wrong')")).rejects.toThrow(/not valid/);
    // Nothing else is reachable: the shared lookup is not callable, the request table is not readable.
    await expect(db.as(null, "select uniattend._api_connection($1)", [key])).rejects.toThrow(/permission denied/);
    await expect(db.as(u.adminA, "select * from uniattend.integration_requests")).rejects.toThrow(/permission denied/);
  });

  it("a paused connection is refused, with or without a retry key", async () => {
    const conn = (await db.admin<{ id: string }>("select id from uniattend.integrations where name = 'SIS push v1'"))[0].id;
    await db.as(u.adminA, "select uniattend.integration_action($1, 'pause')", [conn]);
    await expect(push(key, body(4))).rejects.toThrow(/paused/);
    await expect(push(key, body(2), "retry-test-0001")).rejects.toThrow(/paused/);
  });
});

describe("UniAttend staff see a university's records only while it lets them", () => {
  const n = async (who: string, sql: string, params: unknown[] = []) => (await db.as(who, sql, params)).length;
  const personal = async (who: string) => ({
    students: await n(who, "select 1 from uniattend.students where institution_id = $1", [id.instA]),
    records: await n(who, "select 1 from uniattend.attendance_records where institution_id = $1", [id.instA]),
    lecturers: await n(who, "select 1 from uniattend.lecturers where institution_id = $1", [id.instA]),
    audit: await n(who, "select 1 from uniattend.audit_logs where institution_id = $1", [id.instA]),
    enrolments: await n(who, "select 1 from uniattend.module_enrolments where institution_id = $1", [id.instA]),
  });
  const grant = (who: string, hours = 4, reason = "Help with the timetable import") =>
    db.as(who, "select uniattend.grant_support_access($1, $2, $3)", [id.instA, hours, reason]);

  it("without a grant, UniAttend staff see no students, attendance, lecturers or institution audit entries", async () => {
    expect(await personal(u.super)).toEqual({ students: 0, records: 0, lecturers: 0, audit: 0, enrolments: 0 });
    await expect(db.as(u.super, "select uniattend.institution_report($1)", [id.instA])).rejects.toThrow(/Not allowed/);
    await expect(db.as(u.super, "select uniattend.review_queue($1)", [id.instA])).rejects.toThrow(/Only lecturers and administrators/);
    await expect(db.as(u.super, "select * from uniattend.module_report($1)", [id.modA])).rejects.toThrow(/not your module/);
    // Profiles: only administrators' own contact details.
    const lectProfile = await n(u.super, "select 1 from uniattend.profiles where id = $1", [u.lectA]);
    const adminProfile = await n(u.super, "select 1 from uniattend.profiles where id = $1", [u.adminA]);
    expect([lectProfile, adminProfile]).toEqual([0, 1]);
  });

  it("platform work still needs no grant: billing, onboarding, setup, the first administrator", async () => {
    expect(await n(u.super, "select 1 from uniattend.institution_subscriptions where institution_id = $1", [id.instA])).toBeGreaterThan(0);
    await db.as(u.super, "select uniattend.onboarding_status($1)", [id.instA]);
    await db.as(u.super, "update uniattend.institution_settings set timetable_source_url = timetable_source_url where institution_id = $1", [id.instA]);
    const fresh = await db.newUser("second.admin@uniA.ac.za");
    await db.as(u.super, "select uniattend.grant_role($1, 'second.admin@uniA.ac.za', 'institution_admin')", [id.instA]);
    await expect(db.as(u.super, "select uniattend.grant_role($1, $2, 'auditor')", [id.instA, "second.admin@uniA.ac.za"])).rejects.toThrow(/institution admin only/);
    expect(await n(fresh, "select 1 from uniattend.my_roles() where role = 'institution_admin'")).toBe(1);
  });

  it("only the institution's own administrators give access, for 1 hour to 7 days, with a reason", async () => {
    await expect(grant(u.super)).rejects.toThrow(/Only your institution's administrators/);
    await expect(grant(u.adminB)).rejects.toThrow(/Only your institution's administrators/);
    await expect(grant(u.lectA)).rejects.toThrow(/Only your institution's administrators/);
    await expect(grant(u.adminA, 0)).rejects.toThrow(/between 1 hour and 7 days/);
    await expect(grant(u.adminA, 169)).rejects.toThrow(/between 1 hour and 7 days/);
    await expect(grant(u.adminA, 4, "hi")).rejects.toThrow(/Say what UniAttend should help with/);
  });

  it("with a grant, UniAttend staff can help; it is audited, staff are told, and it ends when withdrawn", async () => {
    const before = await personal(u.adminA);
    await grant(u.adminA, 4);
    expect(await personal(u.super)).toMatchObject({ students: before.students, records: before.records });
    expect(await n(u.super, "select 1 from uniattend.notifications where kind = 'support_access'")).toBe(1);
    expect(await n(u.adminA, "select 1 from uniattend.audit_logs where action = 'support_access_granted'")).toBe(1);
    const ov = (await db.asOne<{ support_access_overview: { institution_id: string }[] }>(u.super, "select uniattend.support_access_overview()")).support_access_overview;
    expect(ov.map((x) => x.institution_id)).toContain(id.instA);
    // Only that institution.
    expect(await n(u.super, "select 1 from uniattend.students where institution_id = $1", [id.instB])).toBe(0);
    await db.as(u.adminA, "select uniattend.revoke_support_access($1)", [id.instA]);
    expect(await personal(u.super)).toMatchObject({ students: 0, records: 0 });
    expect(await n(u.adminA, "select 1 from uniattend.audit_logs where action = 'support_access_revoked'")).toBe(1);
  });

  it("an expired grant gives nothing", async () => {
    await grant(u.adminA, 1);
    await db.admin("update uniattend.support_access_grants set expires_at = created_at + interval '1 second' where institution_id = $1 and revoked_at is null", [id.instA]);
    await db.admin("select pg_sleep(1.1)");
    expect((await personal(u.super)).students).toBe(0);
    expect(await n(u.adminA, "select 1 from uniattend.support_access_grants where institution_id = $1", [id.instA])).toBeGreaterThanOrEqual(2);
    expect(await n(u.adminB, "select 1 from uniattend.support_access_grants")).toBe(0);
  });
});
