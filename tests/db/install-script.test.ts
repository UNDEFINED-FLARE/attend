import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { expect, it } from "vitest";
import { SUPABASE_SHIM } from "./harness";

// The bundled SQL-editor script must install cleanly next to another app's
// tables of the same names in `public`, leave them untouched, and refuse to
// run a second time.
it("install script coexists with an existing app in public and is not re-runnable", async () => {
  execFileSync(process.execPath, [join(__dirname, "..", "..", "scripts", "bundle-sql.mjs")]);
  const sql = readFileSync(join(__dirname, "..", "..", "supabase", "install-uniattend.sql"), "utf8");
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_SHIM);
  await db.exec(`
    create table public.profiles (id uuid primary key, role text);
    create table public.attendance_records (id serial primary key, note text);
    create table public.notifications (id serial primary key);
    insert into public.attendance_records (note) values ('acvosa row');
    create function public.handle_new_user() returns trigger language plpgsql as $$ begin return new; end $$;
  `);
  await db.exec(sql);
  const n = await db.query<{ n: number }>("select count(*)::int n from pg_tables where schemaname = 'uniattend'");
  expect(n.rows[0].n).toBeGreaterThan(25);
  const other = await db.query<{ note: string }>("select note from public.attendance_records");
  expect(other.rows).toEqual([{ note: "acvosa row" }]);
  await expect(db.exec(sql)).rejects.toThrow(/already installed/);
}, 180_000); // the whole installer on PGlite: slow on a busy machine
