import { beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "./harness";

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
}, 120_000);

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
