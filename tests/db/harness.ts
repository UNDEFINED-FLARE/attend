// Runs the real migrations against an in-process Postgres (PGlite) with a
// Supabase-shaped auth schema, so RLS and the definer functions are exercised
// exactly as they will be in production — as the `authenticated` role with a
// JWT subject — without needing Docker or a hosted project.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const MIGRATIONS = join(__dirname, "..", "..", "supabase", "migrations");

const SUPABASE_SHIM = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    email_confirmed_at timestamptz,
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`;

export type Db = PGlite & {
  as<T = Record<string, unknown>>(user: string | null, sql: string, params?: unknown[]): Promise<T[]>;
  asOne<T = Record<string, unknown>>(user: string | null, sql: string, params?: unknown[]): Promise<T>;
  admin<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  newUser(email: string, opts?: { confirmed?: boolean; meta?: object }): Promise<string>;
};

export async function createDb(): Promise<Db> {
  const db = new PGlite({ extensions: { pgcrypto } }) as Db;
  await db.exec(SUPABASE_SHIM);
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
    } catch (e) {
      throw new Error(`migration ${f} failed: ${(e as Error).message}`);
    }
  }
  // Supabase's default table privileges; RLS is what actually restricts.
  await db.exec(`
    grant usage on schema public to anon, authenticated;
    grant select, insert, update, delete on all tables in schema public to anon, authenticated;
    grant usage on all sequences in schema public to anon, authenticated;
  `);

  db.admin = async (sql, params = []) => {
    await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
    return (await db.query(sql, params)).rows as never;
  };

  // Every call runs as `authenticated` (or `anon` when user is null) with that
  // user's id as the JWT subject, and always returns to the superuser after.
  db.as = async (user, sql, params = []) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ""]);
    await db.exec(user ? "set role authenticated" : "set role anon");
    try {
      return (await db.query(sql, params)).rows as never;
    } finally {
      await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
    }
  };
  db.asOne = async (user, sql, params) => (await db.as(user, sql, params))[0] as never;

  db.newUser = async (email, opts = {}) => {
    const [r] = await db.admin<{ id: string }>(
      `insert into auth.users (email, email_confirmed_at, raw_user_meta_data)
       values ($1, case when $2 then now() end, $3) returning id`,
      [email, opts.confirmed ?? true, JSON.stringify(opts.meta ?? {})],
    );
    return r.id;
  };
  return db;
}
