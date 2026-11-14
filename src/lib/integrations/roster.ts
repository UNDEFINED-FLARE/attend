// The one shape every source is turned into before it reaches the database
// (uniattend.roster_apply): modules, and people with the modules they study or teach.
// Pure functions only, so they are easy to test.
import { z } from "zod";
import { csvObjects } from "@/lib/csv";
import { PROVIDER_KEYS } from "./providers";

export type RosterPerson = { role: "student" | "lecturer"; number: string; full_name: string; email?: string; module_codes: string[] };
export type Roster = { modules: { code: string; title: string }[]; people: RosterPerson[] };

export const ConnectionOptions = z.object({
  /** Create modules that the source has and UniAttend doesn't. Off: only people in existing modules are loaded. */
  create_modules: z.boolean().default(false),
  /** After a complete sync, mark as dropped the enrolments this connection made that the source no longer has. */
  drop_missing: z.boolean().default(false),
  /** Moodle: which field holds the student number. */
  student_number_from: z.enum(["idnumber", "username", "email"]).default("idnumber"),
  /** Moodle: which course field holds the module code. */
  course_code_from: z.enum(["shortname", "idnumber"]).default("shortname"),
  /** Moodle: "CSC1541_2026_S1" is read as CSC1541. */
  trim_course_code: z.boolean().default(true),
  /** Which system this is (ITS, Banner…), chosen in the setup wizard. Only labels the connection. */
  provider: z.enum(PROVIDER_KEYS).optional(),
});
export type ConnectionOptions = z.infer<typeof ConnectionOptions>;
export const parseOptions = (raw: unknown): ConnectionOptions => ConnectionOptions.catch(ConnectionOptions.parse({})).parse(raw ?? {});

const clean = (v: unknown) => String(v ?? "").trim();
const first = (row: Record<string, string>, keys: string[]) => { for (const k of keys) if (clean(row[k])) return clean(row[k]); return ""; };

/** "CSC1541_2026_S1" or "CSC 1541 Group A" → "CSC1541"; anything else is kept whole. */
export function moduleCode(raw: string, trim = true): string {
  const s = clean(raw).toUpperCase();
  if (!trim) return s;
  const m = /^([A-Z]{2,6})[\s_-]?(\d{3,5}[A-Z]?)(?![A-Z0-9])/.exec(s);
  return m ? m[1] + m[2] : s;
}

/**
 * A roster file. One row per person per module, in any column order:
 *   role (student | lecturer; default student), number (or student_number / staff_number),
 *   full_name (or name, or first_name + last_name), email, module_code, module_title
 */
export function rosterFromCsv(text: string): Roster {
  const rows = csvObjects(text);
  const people = new Map<string, RosterPerson>();
  const modules = new Map<string, string>();
  for (const r of rows) {
    const roleRaw = first(r, ["role", "type"]).toLowerCase();
    const role: RosterPerson["role"] = /^(lecturer|teacher|staff|instructor)/.test(roleRaw) || (!roleRaw && !!clean(r.staff_number)) ? "lecturer" : "student";
    const number = first(r, role === "lecturer" ? ["number", "staff_number", "employee_number", "id"] : ["number", "student_number", "student_no", "id"]);
    const full_name = first(r, ["full_name", "name", "fullname"]) || [clean(r.first_name), clean(r.last_name || r.surname)].filter(Boolean).join(" ");
    const email = first(r, ["email", "email_address"]).toLowerCase();
    const code = moduleCode(first(r, ["module_code", "module", "course_code", "course"]), false);
    if (code) modules.set(code, first(r, ["module_title", "module_name", "course_title", "course_name"]) || modules.get(code) || code);
    if (!number && !full_name && !email) continue;
    const key = `${role}|${number.toUpperCase() || email}`;
    const p = people.get(key) ?? { role, number, full_name, ...(email ? { email } : {}), module_codes: [] };
    if (code && !p.module_codes.includes(code)) p.module_codes.push(code);
    people.set(key, p);
  }
  return { modules: [...modules].map(([code, title]) => ({ code, title })), people: [...people.values()] };
}

const JsonRoster = z.object({
  modules: z.array(z.object({ code: z.string(), title: z.string().optional() })).default([]),
  people: z.array(z.object({
    role: z.string().default("student"), number: z.union([z.string(), z.number()]).transform(String).default(""),
    full_name: z.string().default(""), email: z.string().optional().nullable(),
    module_codes: z.array(z.string()).default([]),
  })).default([]),
});

/** The same thing as JSON: { modules: [...], people: [...] }. Unknown fields are ignored. */
export function rosterFromJson(raw: unknown): Roster {
  const p = JsonRoster.parse(raw);
  return {
    modules: p.modules.map((m) => ({ code: m.code, title: m.title || m.code })),
    people: p.people.map((x) => ({
      role: /^(lecturer|teacher|staff)/i.test(x.role) ? "lecturer" : "student", number: x.number, full_name: x.full_name,
      ...(x.email ? { email: x.email } : {}), module_codes: x.module_codes,
    })),
  };
}

export function rosterFromText(text: string, contentType = ""): Roster {
  const t = text.replace(/^﻿/, "").trimStart();
  if (/json/i.test(contentType) || t.startsWith("{")) return rosterFromJson(JSON.parse(t));
  return rosterFromCsv(text);
}

// ------------------------------------------------------------ Moodle

export type MoodleCourse = { id: number; shortname: string; fullname: string; idnumber?: string };
export type MoodleUser = { id: number; username?: string; fullname?: string; email?: string; idnumber?: string; roles?: { shortname?: string }[] };

const STUDENT_ROLES = new Set(["student"]);
const LECTURER_ROLES = new Set(["editingteacher", "teacher"]);

export function courseCode(c: MoodleCourse, o: ConnectionOptions): string {
  return moduleCode((o.course_code_from === "idnumber" ? c.idnumber : c.shortname) || c.shortname || "", o.trim_course_code);
}

/** The people enrolled in one Moodle course, as roster rows for its module. */
export function moodlePeople(code: string, users: MoodleUser[], o: ConnectionOptions): RosterPerson[] {
  const out: RosterPerson[] = [];
  for (const u of users) {
    const roles = (u.roles ?? []).map((r) => clean(r.shortname).toLowerCase());
    const email = clean(u.email).toLowerCase();
    const base = { full_name: clean(u.fullname), ...(email ? { email } : {}), module_codes: [code] };
    if (roles.some((r) => LECTURER_ROLES.has(r))) {
      out.push({ role: "lecturer", number: clean(u.idnumber), ...base });
    } else if (roles.some((r) => STUDENT_ROLES.has(r))) {
      const number = o.student_number_from === "username" ? clean(u.username)
        : o.student_number_from === "email" ? email.split("@")[0] : clean(u.idnumber) || clean(u.username);
      out.push({ role: "student", number, ...base });
    }
  }
  return out;
}

/** Split a roster so each piece carries at most `size` people (modules ride with the first piece). */
export function chunkRoster(r: Roster, size = 2000): Roster[] {
  if (r.people.length <= size) return [r];
  const out: Roster[] = [];
  for (let i = 0; i < r.people.length; i += size) out.push({ modules: i === 0 ? r.modules : [], people: r.people.slice(i, i + size) });
  return out;
}
