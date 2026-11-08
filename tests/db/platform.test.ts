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
