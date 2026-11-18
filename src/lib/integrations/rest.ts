// Reading a university's own JSON API: where the records are, how pages follow
// each other, and which field holds what. Pure functions only (no network), so the
// whole connector's logic is unit-tested; sources.ts does the requests.

import { z } from "zod";
import { moduleCode, type Roster, type RosterPerson } from "./roster";

/** A dot path into JSON: "data.items", "student.number", "links.next", "modules.0.code". */
const path = z.string().trim().max(120).regex(/^[A-Za-z0-9_$\-.]*$/, "Use field names separated by dots, e.g. data.items").default("");
const name = z.string().trim().max(60).regex(/^[A-Za-z0-9_\-.[\]]*$/, "Use letters, digits, - _ . only").default("");

export const RestConfig = z.object({
  /** Where the list of records is in each response; empty when the response itself is the list. */
  records: path,
  auth: z.enum(["none", "bearer", "header", "oauth2"]).default("bearer"),
  /** For "header": the header that carries the key, e.g. X-API-Key. */
  header_name: z.string().trim().max(60).regex(/^[A-Za-z0-9-]*$/, "A header name has letters, digits and dashes only").default("X-API-Key"),
  /** For "oauth2" (client credentials): where to get a token, who UniAttend is, and the scope. */
  token_url: z.string().trim().max(500).default(""),
  client_id: z.string().trim().max(200).default(""),
  scope: z.string().trim().max(300).default(""),
  paging: z.enum(["none", "page", "offset", "next"]).default("none"),
  page_param: name.transform((v) => v || "page"),
  size_param: name.transform((v) => v || "per_page"),
  page_size: z.coerce.number().int().min(1).max(5000).default(200),
  first_page: z.coerce.number().int().min(0).max(1).default(1),
  offset_param: name.transform((v) => v || "offset"),
  limit_param: name.transform((v) => v || "limit"),
  /** For "next": where the next page's address is in the body (also read from a Link header). */
  next_path: path,
  max_pages: z.coerce.number().int().min(1).max(1000).default(200),
  map: z.object({
    role: path,
    /** Used when there is no role field, or it is empty. */
    role_default: z.enum(["student", "lecturer"]).default("student"),
    number: path.refine((v) => v.length > 0, "Say which field holds the student or staff number."),
    full_name: path,
    first_name: path,
    last_name: path,
    email: path,
    /** A list, or one text with codes separated by commas, semicolons or |. */
    module_codes: path.refine((v) => v.length > 0, "Say which field holds the module code(s)."),
    module_title: path,
  }),
});
export type RestConfig = z.infer<typeof RestConfig>;

/** The value at a dot path; array indexes are numbers ("items.0.code"). */
export function pick(obj: unknown, p: string): unknown {
  if (!p) return obj;
  let cur: unknown = obj;
  for (const part of p.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = Array.isArray(cur) && /^\d+$/.test(part) ? cur[Number(part)] : (cur as Record<string, unknown>)[part];
  }
  return cur;
}

const text = (v: unknown) => (v == null ? "" : typeof v === "object" ? "" : String(v).trim());

/** The records of one response, or an explanation of why there are none. */
export function recordsOf(body: unknown, cfg: Pick<RestConfig, "records">): unknown[] {
  const list = pick(body, cfg.records);
  if (Array.isArray(list)) return list;
  throw new Error(cfg.records
    ? `There is no list at “${cfg.records}” in the response. Check where the records are.`
    : "The response is not a list. Say where the records are (for example data or items).");
}

/** Module codes from a list, objects with a code, or text like "CSC1541; MAT1541". */
export function codesOf(v: unknown): string[] {
  const raw = Array.isArray(v) ? v.map((x) => (x && typeof x === "object" ? text((x as Record<string, unknown>).code ?? (x as Record<string, unknown>).module_code) : text(x)))
    : text(v).split(/[,;|]/);
  return [...new Set(raw.map((c) => moduleCode(c, false)).filter(Boolean))];
}

/** One record as a person with their modules, or null when it names nobody. */
export function personOf(rec: unknown, m: RestConfig["map"]): RosterPerson | null {
  const roleRaw = text(pick(rec, m.role)).toLowerCase();
  const role: RosterPerson["role"] = roleRaw ? (/^(lecturer|teacher|staff|instructor|editingteacher|faculty)/.test(roleRaw) ? "lecturer" : "student") : m.role_default;
  const number = text(pick(rec, m.number));
  const full_name = text(pick(rec, m.full_name)) || [text(pick(rec, m.first_name)), text(pick(rec, m.last_name))].filter(Boolean).join(" ");
  const email = text(pick(rec, m.email)).toLowerCase();
  if (!number && !email) return null;
  return { role, number, full_name, ...(email ? { email } : {}), module_codes: codesOf(pick(rec, m.module_codes)) };
}

/** Records to a roster: people merged by role and number, modules with a title where one is mapped. */
export function rosterOf(records: unknown[], m: RestConfig["map"]): { roster: Roster; skipped: number } {
  const people = new Map<string, RosterPerson>();
  const modules = new Map<string, string>();
  let skipped = 0;
  for (const rec of records) {
    const p = personOf(rec, m);
    if (!p) { skipped++; continue; }
    const title = text(pick(rec, m.module_title));
    for (const c of p.module_codes) modules.set(c, (p.module_codes.length === 1 && title) || modules.get(c) || c);
    const key = `${p.role}|${(p.number || p.email || "").toUpperCase()}`;
    const prev = people.get(key);
    if (prev) { for (const c of p.module_codes) if (!prev.module_codes.includes(c)) prev.module_codes.push(c); }
    else people.set(key, p);
  }
  return { roster: { modules: [...modules].map(([code, title]) => ({ code, title })), people: [...people.values()] }, skipped };
}

/**
 * The address of page `index` (0-based), or null when there are no more pages.
 * `prev` describes the page just read: how many records it had, its body and Link header.
 */
export function pageUrl(base: string, cfg: RestConfig, index: number, prev?: { count: number; body: unknown; link: string | null }): string | null {
  if (index >= cfg.max_pages) return null;
  if (cfg.paging === "none") return index === 0 ? base : null;
  if (cfg.paging === "next") {
    if (index === 0) return base;
    if (!prev) return null;
    const fromBody = text(pick(prev.body, cfg.next_path));
    const fromLink = /<([^>]+)>\s*;\s*rel="?next"?/i.exec(prev.link ?? "")?.[1] ?? "";
    const next = (cfg.next_path && fromBody) || fromLink;
    return next ? new URL(next, base).toString() : null;
  }
  // Page and offset paging stop at the first page that isn't full. Without `prev`
  // (a run carrying on from a saved page) the page is built directly.
  if (prev && prev.count < cfg.page_size) return null;
  const u = new URL(base);
  if (cfg.paging === "page") { u.searchParams.set(cfg.page_param, String(cfg.first_page + index)); u.searchParams.set(cfg.size_param, String(cfg.page_size)); }
  else { u.searchParams.set(cfg.offset_param, String(index * cfg.page_size)); u.searchParams.set(cfg.limit_param, String(cfg.page_size)); }
  return u.toString();
}

/** Page and offset paging can carry on in a later run from a saved page number; "next" links cannot. */
export const resumable = (cfg: RestConfig) => cfg.paging === "page" || cfg.paging === "offset";
