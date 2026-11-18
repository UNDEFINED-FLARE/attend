import { beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "./harness";

// "Can someone take or forge an API key and get the data?"
// UniAttend has two kinds of key:
//   - the Supabase anon (public) key, which is in the browser by design — RLS is the control,
//     proven in rls-coverage.test.ts (a signed-out client reads no tenant data);
//   - an institution API key (ua_<48 hex>) for an institution's own system to push its roster.
// This exercises the institution API key the way the public /api/v1 routes do (as anon, with the
// key as the only authority) and proves the blast radius of a stolen or forged one is small.

let db: Db;
let superId: string, adminA: string, adminB: string, instA: string, instB: string;
let connA: string, keyA: string, keyB: string;

const anon = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.as<T>(null, sql, params);
const anonOne = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.asOne<T>(null, sql, params);
const roster = { complete: false, modules: [{ code: "CSC101", title: "Intro" }],
  people: [{ role: "student", number: "S0001", full_name: "A Student", email: "s1@a.ac.za", module_codes: ["CSC101"] }] };

beforeAll(async () => {
  db = await createDb();
  superId = await db.newUser("root@uniattend.app");
  await db.admin("insert into uniattend.user_roles (user_id, role) values ($1, 'super_admin')", [superId]);
  adminA = await db.newUser("admin@a.ac.za");
  adminB = await db.newUser("admin@b.ac.za");
  instA = (await db.asOne<{ r: string }>(adminA, "select uniattend.request_institution('Anon A', 'anon-a') as r")).r;
  instB = (await db.asOne<{ r: string }>(adminB, "select uniattend.request_institution('Anon B', 'anon-b') as r")).r;
  await db.as(superId, "select uniattend.set_institution_status($1, 'active')", [instA]);
  await db.as(superId, "select uniattend.set_institution_status($1, 'active')", [instB]);
  const a = await db.asOne<{ save_integration: { id: string; api_key: string } }>(adminA,
    "select uniattend.save_integration($1, null, 'api', 'A system', null, null, '{}'::jsonb, 'manual')", [instA]);
  const b = await db.asOne<{ save_integration: { id: string; api_key: string } }>(adminB,
    "select uniattend.save_integration($1, null, 'api', 'B system', null, null, '{}'::jsonb, 'manual')", [instB]);
  connA = a.save_integration.id; keyA = a.save_integration.api_key; keyB = b.save_integration.api_key;
}, 120_000);

describe("key shape and storage", () => {
  it("issues a 192-bit random key and stores only its hash, never the key", async () => {
    expect(keyA).toMatch(/^ua_[0-9a-f]{48}$/);
    const rows = await db.admin<{ key_sha256: string | null; token: string | null }>(
      "select key_sha256, token from uniattend.integration_secrets");
    // The raw key appears nowhere; only a sha256 hash is stored.
    expect(rows.every((r) => r.key_sha256 && r.key_sha256 !== keyA && r.token === null)).toBe(true);
  });
});

describe("a forged or guessed key gets nothing", () => {
  it("rejects a random key, a blank key and null", async () => {
    await expect(anon("select uniattend.api_status($1)", ["ua_" + "0".repeat(48)])).rejects.toThrow(/not valid/i);
    await expect(anon("select uniattend.api_status($1)", [""])).rejects.toThrow(/not valid/i);
    await expect(anon("select uniattend.api_status($1)", [null])).rejects.toThrow(/not valid/i);
  });
});

describe("a stolen key reaches only its own institution", () => {
  it("pushes a roster to its own institution and nowhere else", async () => {
    const res = await anonOne<{ api_roster_push: { run_id: string } }>(
      "select uniattend.api_roster_push($1, $2::jsonb) as api_roster_push", [keyA, JSON.stringify(roster)]);
    expect(res.api_roster_push.run_id).toMatch(/^[0-9a-f-]{36}$/);
    const [{ n: inA }] = await db.admin<{ n: number }>(
      "select count(*)::int as n from uniattend.students where institution_id = $1", [instA]);
    const [{ n: inB }] = await db.admin<{ n: number }>(
      "select count(*)::int as n from uniattend.students where institution_id = $1", [instB]);
    expect(inA).toBe(1);
    expect(inB).toBe(0); // key A could not touch institution B
  });

  it("sees only its own institution through status", async () => {
    const sA = await anonOne<{ api_status: { institution: string } }>("select uniattend.api_status($1) as api_status", [keyA]);
    const sB = await anonOne<{ api_status: { institution: string } }>("select uniattend.api_status($1) as api_status", [keyB]);
    expect(sA.api_status.institution).toBe("Anon A");
    expect(sB.api_status.institution).toBe("Anon B");
  });

  it("cannot read another connection's run, even with the run id (no IDOR)", async () => {
    const [{ id: runA }] = await db.admin<{ id: string }>(
      "select id from uniattend.integration_runs where institution_id = $1 order by started_at desc limit 1", [instA]);
    // B's valid key, A's real run id → refused.
    await expect(anon("select uniattend.api_run($1, $2)", [keyB, runA])).rejects.toThrow(/no such run/i);
    // A's own key can read A's run.
    const own = await anonOne<{ api_run: { id: string } }>("select uniattend.api_run($1, $2) as api_run", [keyA, runA]);
    expect(own.api_run.id).toBe(runA);
  });

  it("gives the API-key caller no way to read attendance (anon cannot, key adds nothing)", async () => {
    const [{ n }] = (await anon("select count(*)::int as n from uniattend.attendance_records")) as { n: number }[];
    expect(n).toBe(0);
  });
});

describe("a leaked key can be rotated (incident response)", () => {
  it("kills the old key and issues a new one", async () => {
    const r = await db.asOne<{ integration_action: { api_key: string } }>(adminA,
      "select uniattend.integration_action($1, 'new_key') as integration_action", [connA]);
    const newKey = r.integration_action.api_key;
    expect(newKey).toMatch(/^ua_[0-9a-f]{48}$/);
    expect(newKey).not.toBe(keyA);
    await expect(anon("select uniattend.api_status($1)", [keyA])).rejects.toThrow(/not valid/i); // old key dead
    const ok = await anonOne<{ api_status: { institution: string } }>("select uniattend.api_status($1) as api_status", [newKey]);
    expect(ok.api_status.institution).toBe("Anon A");
  });

  it("refuses a paused connection", async () => {
    const connB = (await db.admin<{ id: string }>("select id from uniattend.integrations where institution_id = $1", [instB]))[0].id;
    await db.as(adminB, "select uniattend.integration_action($1, 'pause')", [connB]);
    await expect(anon("select uniattend.api_roster_push($1, $2::jsonb)", [keyB, JSON.stringify(roster)])).rejects.toThrow(/paused/i);
  });
});
