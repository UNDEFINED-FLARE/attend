// Reads "which lecturer teaches which module" out of rows of cells from any document
// (a spreadsheet, a Word table, PDF lines, a timetable) and matches them to the
// institution's modules and lecturers. Pure: no database, so it can be unit-tested.

export type KnownModule = { id: string; code: string; title: string };
export type KnownLecturer = { id: string; full_name: string; staff_number: string; email: string | null };

export type AssignmentStatus =
  | "assign"        // module and lecturer both found
  | "exists"        // already assigned
  | "new_lecturer"  // lecturer not found; can be created
  | "new_module"    // module code not found; can be created
  | "ambiguous"     // several lecturers fit the name
  | "no_lecturer";  // a module with no recognisable lecturer

export type AssignmentRow = {
  key: string;
  code: string;
  module_id: string | null;
  module_title: string | null;
  lecturer_text: string | null;
  lecturer_id: string | null;
  lecturer_name: string | null;
  email: string | null;
  staff_number: string | null;
  role: "primary" | "assistant";
  status: AssignmentStatus;
  note?: string;
};

const CODE_RE = /\b([A-Z]{2,6}) ?(\d{3,5}[A-Z]?)\b/g;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const TITLES = new Set(["DR", "PROF", "PROFESSOR", "MR", "MRS", "MS", "MISS", "ADV", "REV", "SIR", "ME", "MNR", "MEV", "ASSOC", "SNR", "JNR"]);
const LABEL_RE = /\b(module|course|subject|code|lecturer|lecturers|staff|name|names|teacher|instructor|facilitator|coordinator|convenor|presenter|email|e-mail|role|primary|assistant|tutor|asst)\b\s*[:\-–]?/gi;
const NOT_NAMES = new Set(["THE", "AND", "FOR", "OF", "TO", "IN", "WITH", "ONLINE", "CLASS", "LECTURE", "PRACTICAL", "TUTORIAL", "ROOM", "VENUE",
  "SEMESTER", "YEAR", "GROUP", "WEEK", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY", "TBA", "TBC", "NONE", "N/A"]);

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9@._ -]/g, " ").replace(/\s+/g, " ").trim();

/** Long name words and initials: "Dr N.S. Mello" -> words {MELLO}, initials {N, S}. */
function nameKey(name: string) {
  const toks = norm(name).replace(/[.]/g, " ").split(/[\s-]+/).filter((t) => t && !TITLES.has(t) && /^[A-Z']+$/.test(t));
  const words = new Set<string>(), initials = new Set<string>();
  for (const t of toks) {
    // "NS" in "MELLO NS" is initials; three letters with no vowel ("NSK") is initials too.
    if (t.length >= 3 && /[AEIOUY]/.test(t)) { words.add(t); initials.add(t[0]); }
    else for (const c of t) initials.add(c);
  }
  return { words, initials };
}

/** How well a piece of text names this lecturer: 0 = not at all. Needs a shared surname-like word. */
export function nameScore(text: string, lecturerName: string): number {
  const a = nameKey(text), b = nameKey(lecturerName);
  const shared = [...a.words].filter((w) => b.words.has(w));
  if (!shared.length) return 0;
  // Every other initial/word in the text must fit the lecturer.
  const extra = [...a.words].filter((w) => !b.words.has(w));
  const extraInitials = [...a.initials].filter((c) => !shared.some((w) => w[0] === c));
  for (const w of extra) if (!b.initials.has(w[0])) return 0;
  for (const c of extraInitials) if (!b.initials.has(c)) return 0;
  return shared.length * 10 + extra.length * 3 + extraInitials.length;
}

/** Does this cell look like a person's name (for creating a lecturer who isn't known yet)? */
export function looksLikeName(s: string): boolean {
  const t = s.replace(LABEL_RE, " ").replace(/[.,]/g, " ").trim();
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 6 || t.length > 60) return false;
  if (!words.every((w) => /^[A-Za-z'’-]+$/.test(w))) return false;
  if (words.some((w) => NOT_NAMES.has(w.toUpperCase()))) return false;
  return words.filter((w) => !TITLES.has(w.toUpperCase())).some((w) => w.length >= 3);
}

const tidyName = (s: string) => s.replace(LABEL_RE, " ").replace(/\s+/g, " ").trim()
  .replace(/^[,;:\-–\s]+|[,;:\-–\s]+$/g, "");
/** "MELLO NS" -> "Mello NS", "DR NOMSA DLAMINI" -> "Dr Nomsa Dlamini": title case, initials stay capitals. */
const nameCase = (n: string) => (n === n.toUpperCase()
  ? n.split(" ").map((w) => (TITLES.has(w.replace(/\.$/, "")) || w.length > 3 || /[AEIOUY]/.test(w)
    ? w.toLowerCase().replace(/(^|['-])([a-z])/g, (_, p, c) => p + c.toUpperCase())
    : w)).join(" ")
  : n);

/**
 * The registered lecturer a name refers to: the same name, or the one name that fits
 * ("THANDI MOKOENA" or "MOKOENA T" finds "Dr Thandi Mokoena"). "ambiguous" when several fit.
 */
export function findLecturerByName<L extends { full_name: string }>(name: string, lecturers: L[]): L | "ambiguous" | null {
  const exact = lecturers.filter((l) => l.full_name.trim().toUpperCase() === name.trim().toUpperCase());
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return "ambiguous";
  const scored = lecturers.map((l) => ({ l, s: nameScore(name, l.full_name) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  if (!scored.length) return null;
  return scored.length === 1 || scored[0].s > scored[1].s ? scored[0].l : "ambiguous";
}

type Header = { code?: number; lecturer?: number; email?: number; staff?: number; role?: number; title?: number };

function findHeader(row: string[]): Header | null {
  const h: Header = {};
  row.forEach((c, i) => {
    const x = c.toLowerCase().trim();
    if (h.code == null && /^(module|course|subject)?\s*(code|module|course|subject)$/.test(x)) h.code = i;
    else if (h.email == null && /e-?mail/.test(x)) h.email = i;
    else if (h.staff == null && /(staff|employee|personnel)\s*(no|number|nr|#|id)/.test(x)) h.staff = i;
    else if (h.title == null && /(title|description|(module|course|subject) name)/.test(x)) h.title = i;
    else if (h.lecturer == null && /(lecturer|staff|teacher|instructor|facilitator|coordinator|name)/.test(x)) h.lecturer = i;
    else if (h.role == null && /^(role|type|position)$/.test(x)) h.role = i;
  });
  return h.code != null && (h.lecturer != null || h.email != null || h.staff != null) ? h : null;
}

/** All "lecturer for module" claims in the rows, before matching. */
export function extractClaims(rows: string[][], pairs?: { code: string; lecturer: string }[]) {
  const claims: { code: string; text: string | null; email: string | null; staff: string | null; role: "primary" | "assistant"; line: string; strong: boolean; title?: string | null }[] = [];
  for (const p of pairs ?? []) {
    for (const name of p.lecturer.split(/\s*[;/&]\s*|\s*,\s*(?=[A-Z][A-Z]+\b)/)) {
      if (name.trim()) claims.push({ code: p.code, text: name.trim(), email: null, staff: null, role: "primary", line: `${p.code} — ${p.lecturer}`, strong: true });
    }
  }
  if (pairs?.length) return claims;

  let header: Header | null = null;
  let lastCodes: string[] = [];
  for (const row of rows) {
    const cells = row.map((c) => (c ?? "").trim());
    if (!cells.some(Boolean)) continue;
    const h = findHeader(cells);
    if (h) { header = h; lastCodes = []; continue; }
    const line = cells.filter(Boolean).join(" · ");
    const assistant = /\b(assistant|asst|tutor|co-?lecturer|secondary)\b/i.test(line);

    if (header) {
      const code = norm(cells[header.code!] ?? "").replace(/\s+/g, "");
      const codes = [...code.matchAll(/([A-Z]{2,6})(\d{3,5}[A-Z]?)/g)].map((m) => m[1] + m[2]);
      const email = header.email != null ? EMAIL_RE.exec(cells[header.email] ?? "")?.[0] ?? null : EMAIL_RE.exec(line)?.[0] ?? null;
      const staff = header.staff != null ? (cells[header.staff] ?? "").trim() || null : null;
      const roleCell = header.role != null ? cells[header.role] ?? "" : line;
      const role = /assist|asst|tutor|secondary/i.test(roleCell) ? "assistant" : "primary";
      const names = header.lecturer != null ? (cells[header.lecturer] ?? "").split(/\s*[;/&\n]\s*/).filter(Boolean) : [null];
      // The module's name in the document, so a module created from it gets a real title.
      const title = header.title != null && codes.length === 1 ? (cells[header.title] ?? "").trim().slice(0, 200) || null : null;
      for (const c of codes.length ? codes : lastCodes) {
        for (const n of names) claims.push({ code: c, text: n ? tidyName(n) : null, email: names.length === 1 ? email : null, staff: names.length === 1 ? staff : null, role, line, strong: true, title });
      }
      if (codes.length) lastCodes = codes;
      continue;
    }

    // No header: look for codes and people anywhere in the row.
    const upper = line.toUpperCase();
    const codes = [...upper.matchAll(CODE_RE)].map((m) => m[1] + m[2]);
    const email = EMAIL_RE.exec(line)?.[0] ?? null;
    // Text left once codes, emails and labels are removed: candidate names.
    const rest = cells.map((c) => c.replace(EMAIL_RE, " ").replace(CODE_RE, " ").replace(/\b[A-Z]{2,6} ?\d{3,5}[A-Z]?\b/gi, " ")).map(tidyName).filter(Boolean);
    const labelled = /\b(lecturer|staff|teacher|instructor|facilitator|coordinator|convenor)\s*[:\-–]/i.test(line);
    if (codes.length) lastCodes = codes;
    const target = codes.length ? codes : lastCodes;
    if (!target.length) continue;
    if (!rest.length && !email) { if (codes.length) for (const c of codes) claims.push({ code: c, text: null, email: null, staff: null, role: "primary", line, strong: false }); continue; }
    for (const c of target) {
      for (const r of rest.length ? rest : [null]) {
        claims.push({ code: c, text: r, email, staff: null, role: assistant ? "assistant" : "primary", line, strong: labelled || !!email });
      }
    }
  }
  return claims;
}

/** Match claims to the institution's modules and lecturers; one row per module+lecturer. */
export function matchAssignments(
  rows: string[][],
  modules: KnownModule[],
  lecturers: KnownLecturer[],
  existing: { module_id: string; lecturer_id: string }[],
  pairs?: { code: string; lecturer: string }[],
): AssignmentRow[] {
  const modByCode = new Map(modules.map((m) => [m.code.toUpperCase().replace(/\s+/g, ""), m]));
  const byEmail = new Map(lecturers.filter((l) => l.email).map((l) => [l.email!.toLowerCase(), l]));
  const byStaff = new Map(lecturers.map((l) => [l.staff_number.toUpperCase(), l]));
  const have = new Set(existing.map((e) => `${e.module_id}|${e.lecturer_id}`));
  const out = new Map<string, AssignmentRow>();
  const moduleHasLecturer = new Set<string>();
  const bare: string[] = [];

  for (const c of extractClaims(rows, pairs)) {
    const mod = modByCode.get(c.code) ?? null;
    if (!mod && !c.strong) continue; // an unknown code in free text is too likely to be noise
    let lect: KnownLecturer | null = null, ambiguous = false;
    if (c.email) lect = byEmail.get(c.email.toLowerCase()) ?? null;
    if (!lect && c.staff) lect = byStaff.get(c.staff.toUpperCase()) ?? null;
    if (!lect && c.text) {
      // Staff number typed as a name cell.
      lect = byStaff.get(c.text.toUpperCase()) ?? null;
      if (!lect) {
        const scored = lecturers.map((l) => ({ l, s: nameScore(c.text!, l.full_name) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
        if (scored.length === 1 || (scored.length > 1 && scored[0].s > scored[1].s)) lect = scored[0].l;
        else if (scored.length > 1) ambiguous = true;
      }
    }
    const newName = !lect && c.text && looksLikeName(c.text) && (c.strong || !!c.email) ? nameCase(tidyName(c.text)) : null;
    if (!lect && !newName && !ambiguous) { if (!c.text || c.strong) bare.push(c.code); continue; }

    const status: AssignmentStatus = ambiguous ? "ambiguous"
      : !mod ? "new_module"
      : !lect ? "new_lecturer"
      : have.has(`${mod.id}|${lect.id}`) ? "exists" : "assign";
    const who = lect?.id ?? (newName ?? c.text ?? "").toUpperCase();
    const key = `${c.code}|${who}`;
    if (out.has(key)) continue;
    moduleHasLecturer.add(c.code);
    out.set(key, {
      key, code: c.code, module_id: mod?.id ?? null, module_title: mod?.title ?? c.title ?? null,
      lecturer_text: c.text, lecturer_id: lect?.id ?? null, lecturer_name: lect?.full_name ?? newName ?? c.text,
      email: lect?.email ?? c.email, staff_number: lect?.staff_number ?? c.staff, role: c.role, status,
      note: ambiguous ? "More than one lecturer matches this name." : !lect && !mod ? "New module and new lecturer" : undefined,
    });
  }
  for (const code of new Set(bare)) {
    if (moduleHasLecturer.has(code) || !modByCode.has(code)) continue;
    const m = modByCode.get(code)!;
    out.set(`${code}|`, { key: `${code}|`, code, module_id: m.id, module_title: m.title, lecturer_text: null, lecturer_id: null,
      lecturer_name: null, email: null, staff_number: null, role: "primary", status: "no_lecturer" });
  }
  const order: AssignmentStatus[] = ["assign", "new_lecturer", "new_module", "ambiguous", "exists", "no_lecturer"];
  return [...out.values()].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.code.localeCompare(b.code));
}
