import { beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "./harness";

// Bluetooth evidence at check-in (migration 0037). The lecturer's phone broadcasts a
// value signed with the session secret for the current 20-second step; the student's
// phone reports what it heard and check_in() scores it inside the location layer.

const HALL = { lat: -22.9761, lng: 30.4445 };
// Indoors: the phone only manages ±400 m, above the 150 m the institution accepts,
// so GPS alone earns at most 8 of the 40 location points (score 68, under 70).
const weakGps = { samples: [400, 420, 410].map((accuracy) => ({ ...HALL, accuracy })) };
const goodGps = { samples: [12, 15, 13].map((accuracy, i) => ({ lat: HALL.lat + i * 0.00001, lng: HALL.lng, accuracy })) };

let db: Db;
const u: Record<string, string> = {};
let next = 0; // each scenario uses its own student (a recorded student only gets "duplicate")

type Verdict = { outcome: string; status: string | null; score: number; reasons: string[] };
type Obs = { id: string; rssi: number };

async function institution(tag: string, students: number) {
  const admin = await db.newUser(`admin@${tag}.ac.za`);
  const inst = (await db.asOne<{ request_institution: string }>(admin,
    "select uniattend.request_institution($1, $2)", [`Uni ${tag}`, `uni-${tag}`])).request_institution;
  await db.as(u.super, "select uniattend.set_institution_status($1, 'active')", [inst]);
  const fac = await db.asOne<{ id: string }>(admin, "insert into uniattend.faculties (institution_id, name, code) values ($1, 'Sci', 'SCI') returning id", [inst]);
  const dep = await db.asOne<{ id: string }>(admin, "insert into uniattend.departments (institution_id, faculty_id, name, code) values ($1, $2, 'CS', 'CSC') returning id", [inst, fac.id]);
  const ven = await db.asOne<{ id: string }>(admin,
    "insert into uniattend.venues (institution_id, name, lat, lng, radius_m) values ($1, 'Hall 1', $2, $3, 40) returning id", [inst, HALL.lat, HALL.lng]);
  const mod = await db.asOne<{ id: string }>(admin,
    "insert into uniattend.modules (institution_id, department_id, code, title) values ($1, $2, 'CSC101', 'Intro') returning id", [inst, dep.id]);
  const lect = await db.newUser(`lect@${tag}.ac.za`);
  const l = await db.asOne<{ id: string }>(admin,
    "insert into uniattend.lecturers (institution_id, staff_number, full_name, email) values ($1, 'L1', 'Dr L', $2) returning id", [inst, `lect@${tag}.ac.za`]);
  await db.as(admin, "insert into uniattend.lecturer_assignments (institution_id, module_id, lecturer_id) values ($1, $2, $3)", [inst, mod.id, l.id]);
  await db.as(lect, "select uniattend.link_my_accounts()");
  const nums = Array.from({ length: students }, (_, i) => i + 1);
  await db.as(admin, "select uniattend.import_students($1, $2)", [inst,
    JSON.stringify(nums.map((n) => ({ student_number: `${tag.toUpperCase()}${n}`, full_name: `Student ${n}`, email: `s${n}@${tag}.ac.za`, module_code: "CSC101" })))]);
  const studs: string[] = [];
  for (const n of nums) {
    const s = await db.newUser(`s${n}@${tag}.ac.za`);
    await db.as(s, "select uniattend.link_my_accounts()");
    studs.push(s);
  }
  return { admin, inst, lect, venue: ven.id, mod: mod.id, studs };
}

let A: Awaited<ReturnType<typeof institution>>;
let B: Awaited<ReturnType<typeof institution>>;

async function open(x: typeof A, bluetooth: boolean) {
  const s = await db.asOne<{ id: string; require_gps: boolean }>(x.lect,
    "select * from uniattend.open_session($1, $2, 'Week 1', 90, 10)", [x.mod, x.venue]);
  if (bluetooth) await db.as(x.lect, "select uniattend.set_session_bluetooth($1, true)", [s.id]);
  return s.id;
}
const qr = async (x: typeof A, session: string) =>
  (await db.asOne<{ session_qr_token: { token: string } }>(x.lect, "select uniattend.session_qr_token($1)", [session])).session_qr_token.token;
const beacon = async (x: typeof A, session: string) =>
  (await db.asOne<{ session_ble_token: { open: boolean; bluetooth: boolean; id?: string } }>(x.lect,
    "select uniattend.session_ble_token($1)", [session])).session_ble_token;

async function checkIn(session: string, gps: object | null, ble: { observations: Obs[] } | null, x = A) {
  const student = x.studs[next++];
  const device = (next % 16).toString(16).repeat(64);
  const token = await qr(x, session);
  return (await db.asOne<{ check_in: Verdict }>(student, "select uniattend.check_in($1, null, $2, $3, $4, $5)",
    [session, token, gps ? JSON.stringify(gps) : null, device, ble ? JSON.stringify(ble) : null])).check_in;
}
const layerOf = async (session: string, kind: string) =>
  db.admin<{ data: Record<string, unknown> }>(`select e.data from uniattend.attendance_evidence e
    join uniattend.attendance_records r on r.id = e.record_id where r.session_id = $1 and e.kind = $2 order by e.created_at`, [session, kind]);

let S: string; // institution A's Bluetooth session

beforeAll(async () => {
  db = await createDb();
  u.super = await db.newUser("root@uniattend.app");
  await db.admin("insert into uniattend.user_roles (user_id, role) values ($1, 'super_admin')", [u.super]);
  A = await institution("blue", 16);
  B = await institution("other", 1);
  for (const x of [A, B]) await db.as(x.admin, "select uniattend.set_bluetooth_policy($1, true, -90)", [x.inst]);
  S = await open(A, true);
}, 180_000);

describe("switches (off by default)", () => {
  it("is off for a new institution and a new session", async () => {
    const defaults = await db.admin<{ column_name: string; column_default: string }>(
      `select column_name, column_default from information_schema.columns where table_schema = 'uniattend'
        and (table_name, column_name) in (('institution_settings','bluetooth_enabled'), ('institution_settings','bluetooth_min_rssi'), ('class_sessions','use_bluetooth'))
        order by column_name`);
    expect(defaults.map((d) => [d.column_name, d.column_default])).toEqual([
      ["bluetooth_enabled", "false"], ["bluetooth_min_rssi", "'-90'::integer"], ["use_bluetooth", "false"]]);
    const s = await db.asOne<{ use_bluetooth: boolean }>(A.lect,
      "select use_bluetooth from uniattend.open_session($1, $2, 'Defaults', 90, 10)", [A.mod, A.venue]);
    expect(s.use_bluetooth).toBe(false);
  });

  it("only an institution admin sets the policy, within range", async () => {
    await expect(db.as(A.lect, "select uniattend.set_bluetooth_policy($1, false, -90)", [A.inst])).rejects.toThrow(/institution admin only/);
    await expect(db.as(B.admin, "select uniattend.set_bluetooth_policy($1, false, -90)", [A.inst])).rejects.toThrow(/institution admin only/);
    await expect(db.as(A.admin, "select uniattend.set_bluetooth_policy($1, true, -20)", [A.inst])).rejects.toThrow(/between -110 and -40/);
  });

  it("a lecturer cannot turn it on for a session while the institution has it off", async () => {
    const x = await institution("closed", 0);
    const s = await db.asOne<{ id: string }>(x.lect, "select * from uniattend.open_session($1, $2, 'W1', 90, 10)", [x.mod, x.venue]);
    await expect(db.as(x.lect, "select uniattend.set_session_bluetooth($1, true)", [s.id])).rejects.toThrow(/turned off for your institution/);
    expect((await beacon(x, s.id))).toEqual({ open: true, bluetooth: false });
  });

  it("only the session's lecturer gets the signal; nobody can call the signer directly", async () => {
    await expect(db.as(A.studs[15], "select uniattend.session_ble_token($1)", [S])).rejects.toThrow(/not your session/);
    await expect(db.as(B.lect, "select uniattend.session_ble_token($1)", [S])).rejects.toThrow(/not your session/);
    await expect(db.as(B.lect, "select uniattend.set_session_bluetooth($1, false)", [S])).rejects.toThrow(/not your session/);
    await expect(db.as(A.studs[15], "select uniattend.session_ble_id($1, 1)", [S])).rejects.toThrow(/permission denied/);
    const t = await beacon(A, S);
    expect(t).toMatchObject({ open: true, bluetooth: true });
    expect(t.id).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("scoring", () => {
  it("weak indoor GPS alone goes to review (the baseline)", async () => {
    const v = await checkIn(S, weakGps, null);
    expect(v).toMatchObject({ outcome: "review", status: "pending_verification", score: 68 });
  });

  it("weak GPS plus a strong current signal is accepted", async () => {
    const { id: sig } = await beacon(A, S);
    const v = await checkIn(S, weakGps, { observations: [{ id: sig!, rssi: -63 }, { id: sig!, rssi: -67 }] });
    expect(v).toMatchObject({ outcome: "accepted", status: "present", score: 96 });
    expect(v.reasons.join(" ")).toMatch(/Bluetooth signal was heard nearby/);
    const ev = (await layerOf(S, "bluetooth")).at(-1)!.data;
    expect(ev).toMatchObject({ points: 36, max: 36, heard: 2, matched: 2, best_rssi: -63, counted: true });
    // Only a summary is kept: never the value heard.
    expect(JSON.stringify(ev)).not.toContain(sig);
  });

  it("a signal at the far end of the hall still confirms the room (30 points)", async () => {
    const { id: sig } = await beacon(A, S);
    const v = await checkIn(S, null, { observations: [{ id: sig!, rssi: -86 }] });
    // QR 40 + Bluetooth 30 (no location shared at all) + device 20.
    expect(v).toMatchObject({ outcome: "accepted", score: 90 });
  });

  it("a very faint signal does not confirm the room: review, never absent", async () => {
    const { id: sig } = await beacon(A, S);
    const v = await checkIn(S, weakGps, { observations: [{ id: sig!, rssi: -101 }] });
    expect(v).toMatchObject({ outcome: "review", status: "pending_verification", score: 68 });
    expect(v.reasons.join(" ")).toMatch(/very faint/);
  });

  it("never lowers a score that GPS already earned", async () => {
    const v = await checkIn(S, goodGps, { observations: [{ id: "0123456789abcdef", rssi: -50 }] });
    const g = await checkIn(S, goodGps, null);
    expect(v.score).toBe(g.score);
    expect(v.outcome).toBe("accepted");
    expect(v.reasons.join(" ")).not.toMatch(/Bluetooth/);
  });

  it("missing Bluetooth (an iPhone, or permission refused) changes nothing", async () => {
    const v = await checkIn(S, weakGps, { observations: [] });
    expect(v).toMatchObject({ outcome: "review", score: 68 });
  });
});

describe("spoofed, replayed and foreign signals", () => {
  it("a made-up value earns nothing", async () => {
    const v = await checkIn(S, weakGps, { observations: [{ id: "deadbeefdeadbeef", rssi: -55 }] });
    expect(v).toMatchObject({ outcome: "review", score: 68 });
    expect(v.reasons.join(" ")).toMatch(/not this class's current signal/);
    expect((await layerOf(S, "bluetooth")).at(-1)!.data).toMatchObject({ points: 0, heard: 1, matched: 0 });
  });

  it("a value recorded earlier (replayed after it rotated) earns nothing", async () => {
    const [{ old }] = await db.admin<{ old: string }>("select uniattend.session_ble_id($1, uniattend.qr_step() - 5) as old", [S]);
    const v = await checkIn(S, weakGps, { observations: [{ id: old, rssi: -60 }] });
    expect(v).toMatchObject({ outcome: "review", score: 68 });
  });

  it("the signal of a class in another venue or institution earns nothing", async () => {
    const other = await open(B, true);
    const { id: theirs } = await beacon(B, other);
    expect(theirs).toMatch(/^[0-9a-f]{16}$/);
    const v = await checkIn(S, weakGps, { observations: [{ id: theirs!, rssi: -60 }] });
    expect(v).toMatchObject({ outcome: "review", score: 68 });
    // Another session of the same module, same institution: also its own signal.
    const sibling = await open(A, true);
    const { id: sib } = await beacon(A, sibling);
    expect(sib).not.toBe((await beacon(A, S)).id);
    expect(await checkIn(S, weakGps, { observations: [{ id: sib!, rssi: -60 }] })).toMatchObject({ score: 68 });
  });

  it("identical readings, as a made-up list would have, are not trusted", async () => {
    const { id: sig } = await beacon(A, S);
    const v = await checkIn(S, weakGps, { observations: Array.from({ length: 5 }, () => ({ id: sig!, rssi: -60 })) });
    expect(v).toMatchObject({ outcome: "review", score: 68 });
    expect(v.reasons.join(" ")).toMatch(/unusually uniform/);
  });

  it("malformed observations are ignored, not errors", async () => {
    const { id: sig } = await beacon(A, S);
    const v = await checkIn(S, weakGps, { observations: [
      { id: sig!.toUpperCase(), rssi: -60 }, { id: sig!, rssi: 20 }, { id: `${sig}00`, rssi: -60 }, { id: sig!, rssi: "x" as unknown as number },
    ] });
    expect(v).toMatchObject({ outcome: "review", score: 68 });
  });
});

describe("Bluetooth turned off", () => {
  it("a session without Bluetooth ignores even the right signal", async () => {
    const plain = await open(A, true);
    const { id: sig } = await beacon(A, plain);
    await db.as(A.lect, "select uniattend.set_session_bluetooth($1, false)", [plain]);
    expect(await beacon(A, plain)).toEqual({ open: true, bluetooth: false });
    const v = await checkIn(plain, weakGps, { observations: [{ id: sig!, rssi: -60 }] });
    expect(v).toMatchObject({ outcome: "review", score: 68 });
    expect(await layerOf(plain, "bluetooth")).toEqual([]);
  });

  it("turning it off for the institution stops it for sessions already using it", async () => {
    const { id: sig } = await beacon(A, S);
    await db.as(A.admin, "select uniattend.set_bluetooth_policy($1, false, -90)", [A.inst]);
    try {
      const v = await checkIn(S, weakGps, { observations: [{ id: sig!, rssi: -60 }] });
      expect(v).toMatchObject({ outcome: "review", score: 68 });
      expect(await beacon(A, S)).toEqual({ open: true, bluetooth: false });
    } finally {
      await db.as(A.admin, "select uniattend.set_bluetooth_policy($1, true, -90)", [A.inst]);
    }
  });
});

describe("closing the class", () => {
  it("students sent to review stay pending, never absent", async () => {
    await db.as(A.lect, "select uniattend.close_session($1)", [S]);
    const rows = await db.admin<{ status: string; n: number }>(
      "select status, count(*)::int as n from uniattend.attendance_records where session_id = $1 and checked_in_at is not null group by status", [S]);
    expect(rows.find((r) => r.status === "absent")).toBeUndefined();
    expect(rows.find((r) => r.status === "pending_verification")?.n).toBeGreaterThan(0);
  });
});
