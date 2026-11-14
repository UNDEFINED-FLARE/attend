import { beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "./harness";

// Early warning (migration 0015): alerts open by themselves when attendance
// falls below the requirement or a student misses classes in a row, staff follow
// them up as cases, and they close by themselves when things improve.
// Requirement here is 50%, minimum 3 classes before judging, 3 missed in a row.

let db: Db;
const u: Record<string, string> = {};
const id: Record<string, string> = {};

type Alert = { id: string; kind: string; status: string; percent: string | null; missed_in_a_row: number | null; student_number: string };

const studentId = async (num: string) =>
  (await db.admin<{ id: string }>("select id from uniattend.students where student_number = $1", [num]))[0].id;

/** One class: the listed students check in, everyone else is marked absent when it closes. */
async function klass(present: string[]) {
  const s = await db.asOne<{ id: string }>(u.lect, "select * from uniattend.open_session($1, null, 'Lecture', 90, 10)", [id.mod]);
  for (const num of present) {
    await db.admin(`insert into uniattend.attendance_records (institution_id, session_id, module_id, student_id, status, method, checked_in_at)
                    values ($1, $2, $3, $4, 'present', 'qr', now())`, [id.inst, s.id, id.mod, await studentId(num)]);
  }
  await db.as(u.lect, "select uniattend.close_session($1)", [s.id]);
  return s.id;
}

const alertsFor = async (num: string, live = true) =>
  db.admin<Alert>(`select a.id, a.kind, a.status, a.percent::text, a.missed_in_a_row, s.student_number
                   from uniattend.student_alerts a join uniattend.students s on s.id = a.student_id
                   where s.student_number = $1 ${live ? "and a.status in ('open','contacted')" : ""} order by a.kind`, [num]);
const notes = (user: string, kind: string) =>
  db.as<{ title: string }>(user, "select title from uniattend.notifications where kind = $1 order by created_at", [kind]);

beforeAll(async () => {
  db = await createDb();
  u.super = await db.newUser("root@uniattend.app");
  await db.admin("insert into uniattend.user_roles (user_id, role) values ($1, 'super_admin')", [u.super]);

  for (const tag of ["ew", "far"]) {
    const admin = await db.newUser(`admin@${tag}.ac.za`);
    const inst = (await db.asOne<{ request_institution: string }>(admin,
      "select uniattend.request_institution($1, $2)", [`Uni ${tag}`, `uni-${tag}`])).request_institution;
    await db.as(u.super, "select uniattend.set_institution_status($1, 'active')", [inst]);
    u[`admin_${tag}`] = admin;
    id[`inst_${tag}`] = inst;
  }
  u.admin = u.admin_ew;
  id.inst = id.inst_ew;
  await db.as(u.admin, "update uniattend.institution_settings set min_attendance_pct = 50 where institution_id = $1", [id.inst]);

  const mod = await db.asOne<{ id: string }>(u.admin,
    "insert into uniattend.modules (institution_id, code, title) values ($1, 'CSC101', 'Intro to CS') returning id", [id.inst]);
  id.mod = mod.id;

  // the module's lecturer, and a lecturer who does not teach it
  for (const [key, staff, name] of [["lect", "L1", "Dr Lecturer"], ["otherLect", "L2", "Dr Other"]] as const) {
    u[key] = await db.newUser(`${key}@ew.ac.za`);
    const l = await db.asOne<{ id: string }>(u.admin,
      "insert into uniattend.lecturers (institution_id, staff_number, full_name, email) values ($1, $2, $3, $4) returning id",
      [id.inst, staff, name, `${key}@ew.ac.za`]);
    if (key === "lect") {
      await db.as(u.admin, "insert into uniattend.lecturer_assignments (institution_id, module_id, lecturer_id) values ($1, $2, $3)", [id.inst, id.mod, l.id]);
    }
    await db.as(u[key], "select uniattend.link_my_accounts()");
  }

  await db.as(u.admin, "select uniattend.import_students($1, $2)", [id.inst,
    JSON.stringify([1, 2, 3].map((n) => ({ student_number: `E00${n}`, full_name: `Student ${n}`, email: `s${n}@ew.ac.za`, module_code: "CSC101" })))]);
  for (const n of [1, 2, 3]) {
    u[`s${n}`] = await db.newUser(`s${n}@ew.ac.za`);
    await db.as(u[`s${n}`], "select uniattend.link_my_accounts()");
  }
}, 120_000);

describe("opening alerts", () => {
  it("waits for the minimum number of classes before judging", async () => {
    await klass(["E001", "E003"]);
    await klass(["E001", "E003"]);
    expect(await alertsFor("E002")).toHaveLength(0);
  });

  it("opens a low-attendance and a missed-in-a-row alert on the third missed class, and notifies", async () => {
    await klass(["E001", "E003"]);
    const a = await alertsFor("E002");
    expect(a.map((x) => [x.kind, x.status])).toEqual([["low_attendance", "open"], ["missed_in_a_row", "open"]]);
    expect(a[0].percent).toBe("0.0");
    expect(a[1].missed_in_a_row).toBe(3);
    expect(await alertsFor("E001")).toHaveLength(0);
    expect(await alertsFor("E003")).toHaveLength(0);

    const student = await notes(u.s2, "attendance_alert");
    expect(student.map((n) => n.title)).toEqual(["CSC101: your attendance is 0%", "CSC101: you missed 3 classes in a row"]);
    const lecturer = await notes(u.lect, "attendance_alert");
    expect(lecturer.map((n) => n.title)).toEqual(["CSC101: 2 new early-warning alerts"]); // one summary, not one per student
    expect(await notes(u.s1, "attendance_alert")).toHaveLength(0);
  });

  it("never duplicates a live alert", async () => {
    expect((await db.asOne<{ recheck_alerts: number }>(u.admin, "select uniattend.recheck_alerts($1)", [id.inst])).recheck_alerts).toBe(0);
    await db.as(u.admin, "select uniattend.recheck_alerts($1)", [id.inst]);
    expect(await alertsFor("E002")).toHaveLength(2);
  });
});

describe("who can see and act", () => {
  const list = (user: string, inst = id.inst) =>
    db.as<{ student_number: string; kind: string }>(user, "select * from uniattend.list_student_alerts($1)", [inst]);

  it("the module's lecturer and the institution's admin see them; nobody else does", async () => {
    expect((await list(u.lect)).map((r) => r.student_number)).toEqual(["E002", "E002"]);
    expect(await list(u.admin)).toHaveLength(2);
    expect(await list(u.otherLect)).toHaveLength(0);
    expect(await list(u.admin_far)).toHaveLength(0);
    expect(await list(u.s2)).toHaveLength(0);
    expect(await db.as(u.s2, "select * from uniattend.student_alerts")).toHaveLength(0);
    expect(await db.as(u.admin_far, "select * from uniattend.student_alert_events")).toHaveLength(0);
  });

  it("nobody writes the tables directly", async () => {
    const [a] = await alertsFor("E002");
    await expect(db.as(u.lect, "update uniattend.student_alerts set status = 'resolved' where id = $1", [a.id])).rejects.toThrow(/permission denied/);
    await expect(db.as(u.admin, `insert into uniattend.student_alerts (institution_id, student_id, module_id, kind)
                                 values ($1, $2, $3, 'low_attendance')`, [id.inst, await studentId("E001"), id.mod])).rejects.toThrow(/permission denied/);
  });

  it("students, other lecturers and other institutions can't act on them", async () => {
    const [a] = await alertsFor("E002");
    for (const user of [u.s2, u.otherLect, u.admin_far]) {
      await expect(db.as(user, "select uniattend.update_student_alert($1, 'resolved')", [a.id])).rejects.toThrow(/not your alert/);
      await expect(db.as(user, "select * from uniattend.alert_history($1)", [a.id])).rejects.toThrow(/not your alert/);
    }
    await expect(db.as(u.lect, "select uniattend.recheck_alerts($1)", [id.inst])).rejects.toThrow(/institution admin only/);
  });
});

describe("following up a case", () => {
  it("contacted, note, assign, dismiss needs a reason, and it all shows in the history", async () => {
    const [low] = await alertsFor("E002");
    await db.as(u.lect, "select uniattend.update_student_alert($1, 'contacted', 'Emailed the student.')", [low.id]);
    await expect(db.as(u.lect, "select uniattend.update_student_alert($1, 'contacted')", [low.id])).rejects.toThrow(/only an open alert/);
    await expect(db.as(u.lect, "select uniattend.update_student_alert($1, 'dismissed')", [low.id])).rejects.toThrow(/say why/);
    await expect(db.as(u.lect, "select uniattend.update_student_alert($1, 'note', '  ')", [low.id])).rejects.toThrow(/write the note/);
    await db.as(u.lect, "select uniattend.update_student_alert($1, 'note', 'Student is ill, back next week.')", [low.id]);
    await db.as(u.admin, "select uniattend.update_student_alert($1, 'assign_me')", [low.id]);

    const [row] = await db.as<{ status: string; assigned_to: string; last_note: string }>(u.lect,
      "select status, assigned_to, last_note from uniattend.list_student_alerts($1) where kind = 'low_attendance'", [id.inst]);
    expect(row).toEqual({ status: "contacted", assigned_to: u.admin, last_note: "Student is ill, back next week." });

    const h = await db.as<{ action: string; actor_name: string; note: string | null }>(u.lect, "select * from uniattend.alert_history($1)", [low.id]);
    expect(h.map((e) => e.action)).toEqual(["opened", "contacted", "note", "assigned"]);
    expect(h[0]).toMatchObject({ actor_name: "Automatic", note: "Attendance 0%, required 50%." });
    expect(h[1].actor_name).toBe("lect@ew.ac.za");
    const audit = await db.admin<{ n: number }>("select count(*)::int as n from uniattend.audit_logs where entity = 'student_alerts'");
    expect(audit[0].n).toBe(3);
  });
});

describe("closing by themselves", () => {
  it("missed-in-a-row closes when the student attends again; low attendance stays open and updates", async () => {
    await klass(["E001", "E002", "E003"]);
    const live = await alertsFor("E002");
    expect(live.map((x) => [x.kind, x.percent])).toEqual([["low_attendance", "25.0"]]);
    const missed = (await alertsFor("E002", false)).find((x) => x.kind === "missed_in_a_row")!;
    expect(missed.status).toBe("resolved");
    const h = await db.as<{ action: string; note: string }>(u.lect, "select * from uniattend.alert_history($1)", [missed.id]);
    expect(h.at(-1)).toMatchObject({ action: "auto_resolved", note: "Attended again." });
  });

  it("low attendance closes once back at the requirement, and the student is told", async () => {
    await klass(["E001", "E002", "E003"]);
    await klass(["E001", "E002", "E003"]); // 3 of 6 = 50%
    expect(await alertsFor("E002")).toHaveLength(0);
    expect((await notes(u.s2, "attendance_recovered")).map((n) => n.title)).toEqual(["CSC101: attendance back to 50%"]);
  });

  it("a register correction after the class re-checks the alerts", async () => {
    await klass(["E001", "E002"]);
    await klass(["E001", "E002"]);
    const last = await klass(["E001", "E002"]);
    expect((await alertsFor("E003")).map((x) => x.kind)).toEqual(["missed_in_a_row"]); // 6 of 9 attended, so no low alert
    await db.as(u.lect, "select uniattend.save_register($1, $2, 'Was there, phone died.')",
      [last, JSON.stringify([{ student: await studentId("E003"), status: "present" }])]);
    expect(await alertsFor("E003")).toHaveLength(0);
  });

  it("dropping the module closes the student's alerts (after reopening one)", async () => {
    const low = (await alertsFor("E002", false)).find((x) => x.kind === "low_attendance")!;
    await db.as(u.lect, "select uniattend.update_student_alert($1, 'reopened', 'Keeping an eye on this.')", [low.id]);
    expect((await alertsFor("E002")).map((x) => x.status)).toEqual(["open"]);
    await db.as(u.admin, "update uniattend.module_enrolments set status = 'dropped' where student_id = $1", [await studentId("E002")]);
    await db.as(u.admin, "select uniattend.recheck_alerts($1)", [id.inst]);
    expect(await alertsFor("E002")).toHaveLength(0);
    const h = await db.as<{ note: string }>(u.admin, "select * from uniattend.alert_history($1)", [low.id]);
    expect(h.at(-1)!.note).toBe("The student is no longer enrolled in this module.");
  });
});

describe("settings", () => {
  it("switched off: no new alerts until it's back on", async () => {
    await db.as(u.admin, "update uniattend.institution_settings set alerts_enabled = false where institution_id = $1", [id.inst]);
    for (let i = 0; i < 3; i++) await klass(["E003"]);
    expect(await alertsFor("E001")).toHaveLength(0);
    await db.as(u.admin, "update uniattend.institution_settings set alerts_enabled = true where institution_id = $1", [id.inst]);
    await db.as(u.admin, "select uniattend.recheck_alerts($1)", [id.inst]);
    expect((await alertsFor("E001")).map((x) => x.kind)).toEqual(["missed_in_a_row"]);
  });
});
