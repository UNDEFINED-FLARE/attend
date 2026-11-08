import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

// Supabase loads pg_safeupdate for API requests: an UPDATE or DELETE without a
// top-level WHERE fails with "UPDATE requires a WHERE clause", even inside a
// SECURITY DEFINER function. PGlite does not ship that extension, so enforce
// the rule by reading the migrations instead.
const DIR = join(__dirname, "..", "..", "supabase", "migrations");

function statements(sql: string, keyword: "update" | "delete"): { line: number; text: string }[] {
  const code = sql.replace(/--[^\n]*/g, (c) => " ".repeat(c.length)); // drop comments, keep offsets
  const out: { line: number; text: string }[] = [];
  const re = keyword === "update" ? /\bupdate\s+[\w.]+(\s+(?!set\b)\w+)?\s+set\b/gi : /\bdelete\s+from\b/gi;
  for (let m; (m = re.exec(code)); ) {
    const before = code.slice(Math.max(0, m.index - 12), m.index).toLowerCase();
    if (/\b(do|for|or|on|before|after)\s+$/.test(before)) continue; // ON CONFLICT DO UPDATE, triggers, FOR UPDATE
    // Walk to the statement's ';' at parenthesis depth 0, keeping only depth-0 text.
    let depth = 0, top = "";
    for (let i = m.index; i < code.length; i++) {
      const c = code[i];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (c === ";" && depth === 0) break;
      else if (depth === 0) top += c;
    }
    out.push({ line: code.slice(0, m.index).split("\n").length, text: top });
  }
  return out;
}

it("every UPDATE and DELETE in the migrations has a top-level WHERE", () => {
  const offenders: string[] = [];
  for (const f of readdirSync(DIR).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(join(DIR, f), "utf8");
    for (const k of ["update", "delete"] as const) {
      for (const s of statements(sql, k)) {
        if (!/\bwhere\b/i.test(s.text) && !/\busing\b[\s\S]*\bwhere\b/i.test(s.text)) offenders.push(`${f}:${s.line} ${s.text.trim().slice(0, 60)}`);
      }
    }
  }
  expect(offenders).toEqual([]);
});

it("the checker itself catches a WHERE that only appears inside a subquery", () => {
  const bad = statements("update t set e = case when exists (select 1 from m where m.x = 1) then 'x' end;", "update");
  expect(bad).toHaveLength(1);
  expect(/\bwhere\b/i.test(bad[0].text)).toBe(false);
});
