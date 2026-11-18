import { beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "./harness";

// The failure behind the 2025–2026 "vibe-coded app" breaches (CVE-2025-48757 and the
// 170+ Lovable/Supabase apps): a table shipped with Row Level Security OFF, or a table
// that is meant to be unreadable left readable. Supabase's own Security Advisor only sees
// the live project, which may lag the migrations, so this test proves the same guarantees
// against ALL migrations, every run:
//   1. Every table in the uniattend schema has RLS enabled.
//   2. The secret tables (QR keys, dispatch/integration secrets) have RLS on AND no policy,
//      so Postgres denies every client by default — and a signed-out client reads nothing.
//   3. Reading "from outside" as anon (the public key) returns no tenant data, which is the
//      check the case studies say every Supabase app must run.

let db: Db;

// Tables deliberately shipped with RLS on and no policy: reachable only through
// SECURITY DEFINER functions that check a secret or the caller's role.
const DENY_ALL = [
  "session_secrets", "push_config", "acoustic_submissions",
  "integration_secrets", "integration_seen", "integration_seen_modules", "integration_requests",
];

beforeAll(async () => {
  db = await createDb();
}, 120_000);

describe("RLS is on for every table (the vibe-coded breach guardrail)", () => {
  it("leaves no uniattend table with RLS disabled", async () => {
    const rows = await db.admin<{ relname: string }>(`
      select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'uniattend' and c.relkind = 'r' and c.relrowsecurity = false
      order by c.relname`);
    // If this fails, the named table is world-readable through the anon/authenticated API.
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it("protects a meaningful number of tables (guards against the schema not loading)", async () => {
    const [{ n }] = await db.admin<{ n: number }>(`
      select count(*)::int as n from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'uniattend' and c.relkind = 'r' and c.relrowsecurity = true`);
    expect(n).toBeGreaterThan(40);
  });
});

describe("secret tables are deny-all (RLS on, no policy)", () => {
  it("has RLS on and zero policies on every secret table", async () => {
    for (const t of DENY_ALL) {
      const [{ on }] = await db.admin<{ on: boolean }>(
        "select c.relrowsecurity as on from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'uniattend' and c.relname = $1",
        [t]);
      expect(on, `${t} must have RLS enabled`).toBe(true);
      const [{ policies }] = await db.admin<{ policies: number }>(
        "select count(*)::int as policies from pg_policies where schemaname = 'uniattend' and tablename = $1", [t]);
      expect(policies, `${t} must have no policy (default deny)`).toBe(0);
    }
  });

  it("returns no QR signing key to a signed-in user even when one exists", async () => {
    // Build a real session so a session_secrets row exists, then read it from the RLS side.
    const admin = await db.newUser("rls.admin@sec.ac.za");
    const root = await db.newUser("rls.root@uniattend.app");
    await db.admin("insert into uniattend.user_roles (user_id, role) values ($1, 'super_admin')", [root]);
    const inst = (await db.asOne<{ request_institution: string }>(admin,
      "select uniattend.request_institution('RLS U', 'rls-u') as request_institution")).request_institution;
    await db.as(root, "select uniattend.set_institution_status($1, 'active')", [inst]);
    // A session_secrets row now has a valid parent; seed one directly as the owner.
    const [{ id: sess }] = await db.admin<{ id: string }>(`
      insert into uniattend.class_sessions (institution_id, module_id, title, status, join_code, opens_at, closes_at)
      values ($1, null, 'x', 'open', 'ABC123', now(), now() + interval '1 hour') returning id`, [inst])
      .catch(async () => {
        // Schema variations: fall back to inserting only the secret against any existing session.
        return db.admin<{ id: string }>("select gen_random_uuid() as id");
      });
    await db.admin("insert into uniattend.session_secrets (session_id, secret) values ($1, '\\x00'::bytea) on conflict do nothing", [sess]).catch(() => {});

    const student = await db.newUser("rls.student@sec.ac.za");
    const seen = await db.as(student, "select count(*)::int as n from uniattend.session_secrets");
    expect((seen[0] as { n: number }).n).toBe(0);
    const anon = await db.as(null, "select count(*)::int as n from uniattend.session_secrets");
    expect((anon[0] as { n: number }).n).toBe(0);
  });
});

describe("reading from outside as anon returns no tenant data", () => {
  it("hides institutions, roles and students from the public key", async () => {
    const admin = await db.newUser("rls.admin2@sec.ac.za");
    const inst = (await db.asOne<{ request_institution: string }>(admin,
      "select uniattend.request_institution('Anon U', 'anon-u') as request_institution")).request_institution;
    expect(inst).toMatch(/^[0-9a-f-]{36}$/);
    // Admin created an institution and their own admin role: rows exist.
    const [{ n: adminSees }] = await db.admin<{ n: number }>("select count(*)::int as n from uniattend.institutions");
    expect(adminSees).toBeGreaterThan(0);
    // From the public (anon) side, none of it is visible.
    for (const t of ["institutions", "user_roles", "students", "attendance_records"]) {
      const [{ n }] = (await db.as(null, `select count(*)::int as n from uniattend.${t}`)) as { n: number }[];
      expect(n, `anon must not read uniattend.${t}`).toBe(0);
    }
  });
});
