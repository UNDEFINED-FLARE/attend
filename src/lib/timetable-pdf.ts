// Parser for timetable PDFs exported by university "Timetable
// System" (and layouts like it): a week grid with one column per day and, in
// each column, blocks of
//
//   ECS1245                                  <- module code (larger text)
//   15:00-16:50                              <- start-end
//   BUILDING : E-BLOCK @ ROOM : E4 | ONLINE  <- where
//   THEMBA MARVIN MAKHUBELE                  <- lecturer (optional)
//
// Overlapping classes are drawn on top of each other, which garbles a plain
// text dump, but each block is stored contiguously in the PDF with its own
// position. So we read positioned text items, split on module codes, and take
// the day from the column the block sits in.

export type TextItem = { x: number; y: number; h: number; s: string; page: number };

export type ParsedClass = {
  code: string;
  weekday: number; // 1 = Monday
  starts_at: string; // HH:MM
  ends_at: string;
  online: boolean;
  building: string | null;
  room: string | null;
  venue: string | null; // display name for the venue, null when online
  lecturer: string | null;
  // Only from sources that provide them (the timetable website):
  group?: string | null;
  capacity?: number | null;
  students?: number | null; // size of the group(s) in this class
  kind?: "lecture" | "tutorial" | "practical" | "test" | "other";
  sourceId?: number;
};

export type ParsedTimetable = { title: string | null; expected: number | null; classes: ParsedClass[]; warnings: string[] };

const DAYS: Record<string, number> = { MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6, SUN: 7 };
const DAY_RE = /^(MON|TUE|WED|THU|FRI|SAT|SUN)[A-Z]*$/;
const CODE_RE = /^[A-Z]{2,6}\s?\d{3,5}[A-Z]?$/;
const TIME_RE = /^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})$/;
const WHERE_RE = /^BUILDING\s*:\s*(.+?)\s*@\s*ROOM\s*:\s*(.+)$/i;

const pad = (n: string) => n.padStart(2, "0");
const validTime = (h: string, m: string) => +h < 24 && +m < 60;

/** "E-BLOCK" + "E4" -> "E-Block E4"; "MAIN AUDITORIUM" + "AUDITORIUM" -> "Main Auditorium". */
export function venueName(building: string, room: string): string {
  const tidy = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase()
    .replace(/(^|[\s-])([a-z])/g, (_, p, c) => p + c.toUpperCase())
    .replace(/\b([A-Za-z])(\d)/g, (_, a, d) => a.toUpperCase() + d)        // e4 -> E4, lh-01 stays LH-01 below
    .replace(/\b(Lh|Ict|Ems)\b/g, (w) => w.toUpperCase());
  const b = tidy(building), r = tidy(room);
  if (b.toLowerCase().includes(r.toLowerCase())) return b;
  return `${b} ${r}`;
}

/** Reads either supported layout; the layout is detected from the text. */
export function parseTimetableItems(items: TextItem[]): ParsedTimetable {
  const celcat = items.some((i) => CELCAT_START.test(i.s.trim())) || items.some((i) => /CELCAT/i.test(i.s));
  return celcat ? parseCelcatItems(items) : parseBlockItems(items);
}

/** Layout 1: blocks of code / time / BUILDING : x @ ROOM : y / lecturer, one column per day. */
function parseBlockItems(items: TextItem[]): ParsedTimetable {
  const warnings: string[] = [];
  const text = items.map((i) => i.s.trim());
  const expected = Number(text.map((t) => /^(\d+)\s+events?$/i.exec(t)?.[1]).find(Boolean) ?? NaN);
  const title = items.find((i, k) => k > 0 && i.h >= 8 && i.h <= 10 && !/events?$/i.test(i.s) && !DAY_RE.test(i.s.trim()))?.s.trim() ?? null;

  // Day columns per page, from the header row.
  const headers = new Map<number, { x: number; day: number }[]>();
  for (const i of items) {
    const m = DAY_RE.exec(i.s.trim());
    if (m) headers.set(i.page, [...(headers.get(i.page) ?? []), { x: i.x, day: DAYS[m[1]] }]);
  }
  for (const h of headers.values()) h.sort((a, b) => a.x - b.x);
  const dayAt = (page: number, x: number) => {
    const cols = headers.get(page) ?? headers.values().next().value ?? [];
    let best: number | null = null;
    for (const c of cols) if (c.x <= x + 6) best = c.day;
    return best;
  };

  const classes: ParsedClass[] = [];
  const seen = new Set<string>();
  for (let k = 0; k < items.length; k++) {
    const code = text[k].replace(/\s+/g, "");
    if (!CODE_RE.test(text[k]) || !TIME_RE.test(text[k + 1] ?? "")) continue;
    const t = TIME_RE.exec(text[k + 1])!;
    const weekday = dayAt(items[k].page, items[k].x);
    if (!weekday) { warnings.push(`${code}: could not tell which day it is on.`); continue; }
    if (!validTime(t[1], t[2]) || !validTime(t[3], t[4])) { warnings.push(`${code}: unreadable time "${text[k + 1]}".`); continue; }
    const starts_at = `${pad(t[1])}:${t[2]}`, ends_at = `${pad(t[3])}:${t[4]}`;
    if (ends_at <= starts_at) { warnings.push(`${code}: ends before it starts (${text[k + 1]}).`); continue; }

    // The rest of the block runs until the next module code.
    let online = false, building: string | null = null, room: string | null = null, lecturer: string | null = null;
    for (let j = k + 2; j < items.length && j <= k + 5; j++) {
      const s = text[j];
      if (CODE_RE.test(s) && TIME_RE.test(text[j + 1] ?? "")) break;
      const w = WHERE_RE.exec(s);
      if (w) { building = w[1].trim(); room = w[2].trim(); continue; }
      if (/^ONLINE$/i.test(s)) { online = true; continue; }
      if (!lecturer && /^[A-Z][A-Z' .-]+[A-Z]$/.test(s) && (building || online)) lecturer = s.replace(/\s+/g, " ");
    }
    const c: ParsedClass = { code, weekday, starts_at, ends_at, online, building, room,
      venue: !online && building && room ? venueName(building, room) : null, lecturer };
    const key = [c.code, c.weekday, c.starts_at, c.ends_at, c.venue ?? "online"].join("|");
    if (seen.has(key)) continue; // the PDF sometimes repeats an identical block
    seen.add(key);
    classes.push(c);
  }
  classes.sort((a, b) => a.weekday - b.weekday || a.starts_at.localeCompare(b.starts_at) || a.code.localeCompare(b.code));
  if (!classes.length) warnings.push("No classes were found. Is this a timetable exported from the university timetable system?");
  return { title, expected: Number.isFinite(expected) ? expected : null, classes, warnings };
}

/** Positioned text from every page of a PDF (server-side). */
export async function extractPdfItems(data: Uint8Array): Promise<TextItem[]> {
  // Load the worker module ourselves and hand it to pdf.js: on a server it runs
  // in-process, and a static import guarantees the file ships with the deploy.
  const g = globalThis as { pdfjsWorker?: unknown };
  g.pdfjsWorker ??= await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data, verbosity: 0, disableFontFace: true });
  const doc = await task.promise;
  if (doc.numPages > 20) { await task.destroy(); throw new Error("That PDF has more than 20 pages. Upload one timetable at a time."); }
  const out: TextItem[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    for (const i of tc.items) {
      if (!("str" in i) || !i.str.trim()) continue;
      out.push({ x: i.transform[4], y: i.transform[5], h: i.height, s: i.str, page: p });
    }
  }
  await task.destroy();
  return out;
}


// ----------------------------------------------------------------- CELCAT layout
//
// Layout 2: PDFs from CELCAT Timetabling (e.g. Tshwane University of Technology).
// Each class is a block such as
//   CLASS, 05:15pm-08:   45pm   Module: ADM107V   Staff: EBEWO PE
//   Rooms: 31-102 - PTA (112   seats); ONLINE - PTA
// where long lines wrap into separate text items that share the block's column.
// Pages are often rotated, so the day columns may run along x or along y.

const CELCAT_TIME = String.raw`\d{1,2}:\d{2}(?:\s*[ap]m\b)?`;
const CELCAT_START = new RegExp(String.raw`^([A-Za-z][A-Za-z /&-]{1,30}),\s*${CELCAT_TIME}`, "i");
const CELCAT_DAY = /^(mon|tue|tues|wed|wednes|thu|thur|thurs|fri|sat|satur|sun)(day)?$/i;
const DAY_NUM: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };

function to24(t: string): string | null {
  const m = /^(\d{1,2}):(\d{2})\s*([ap]m)?$/i.exec(t.trim());
  if (!m) return null;
  let h = +m[1];
  const min = +m[2];
  if (m[3]) { const pm = m[3].toLowerCase() === "pm"; if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
  return h < 24 && min < 60 ? `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}` : null;
}

function kindOf(label: string): ParsedClass["kind"] {
  const l = label.toLowerCase();
  if (/tut/.test(l)) return "tutorial";
  if (/prac|lab|workshop/.test(l)) return "practical";
  if (/test|exam|assess|quiz/.test(l)) return "test";
  if (/class|lect|lesson|contact/.test(l)) return "lecture";
  return "other";
}

/** "31-106 - PTA (170 seats)" -> room 31-106, campus PTA, capacity 170; "ONLINE - PTA" -> online. */
function parseRooms(raw: string) {
  const parts = raw.split(";").map((p) => p.trim()).filter(Boolean);
  const physical = parts.find((p) => !/^online\b/i.test(p));
  const alsoOnline = parts.some((p) => /^online\b/i.test(p));
  if (!physical) return { online: true, alsoOnline, venue: null, building: null, room: null, capacity: null };
  const m = /^(.+?)(?:\s+-\s+([A-Za-z][A-Za-z ]{0,30}?))?\s*(?:\((\d+)\s*seats?\))?$/i.exec(physical);
  const room = (m?.[1] ?? physical).trim();
  const campus = m?.[2]?.trim() || null;
  const capacity = m?.[3] ? Math.min(+m[3], 10000) : null;
  const blockNo = /^([A-Za-z]*\d+)[-.\s]/.exec(room)?.[1];
  return {
    online: false, alsoOnline, room, capacity,
    venue: campus ? `${room} (${campus})` : room,
    building: blockNo ? `${campus ? `${campus} ` : ""}Building ${blockNo}` : campus,
  };
}

function parseCelcatItems(items: TextItem[]): ParsedTimetable {
  const warnings: string[] = [];
  const title = items.map((i) => i.s.trim()).find((t) => /#\S+/.test(t))?.match(/#(\S+)/)?.[1]
    ?? items.find((i) => i.h >= 12)?.s.trim() ?? null;

  // Day headers, and which axis the day columns run along on each page.
  const headers = new Map<number, { pos: number; day: number }[]>();
  const axisOf = new Map<number, "x" | "y">();
  const byPage = new Map<number, TextItem[]>();
  for (const i of items) {
    const m = CELCAT_DAY.exec(i.s.trim());
    if (m) byPage.set(i.page, [...(byPage.get(i.page) ?? []), i]);
  }
  for (const [page, hs] of byPage) {
    const xs = hs.map((h) => h.x), ys = hs.map((h) => h.y);
    const axis = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys) ? "x" : "y";
    axisOf.set(page, axis);
    headers.set(page, hs.map((h) => ({ pos: axis === "x" ? h.x : h.y, day: DAY_NUM[CELCAT_DAY.exec(h.s.trim())![1].slice(0, 3).toLowerCase()] }))
      .sort((a, b) => a.pos - b.pos));
  }
  const colOf = (i: TextItem) => ((axisOf.get(i.page) ?? "x") === "x" ? i.x : i.y);
  const dayAt = (i: TextItem) => {
    const hs = headers.get(i.page) ?? [];
    if (!hs.length) return null;
    const p = colOf(i);
    // A block starts at the left edge of its column; the header sits a little further in.
    const ahead = hs.filter((h) => h.pos >= p - 10).sort((a, b) => a.pos - b.pos)[0];
    return (ahead ?? hs[hs.length - 1]).day;
  };

  const classes: ParsedClass[] = [];
  const seen = new Set<string>();
  for (let k = 0; k < items.length; k++) {
    if (!CELCAT_START.test(items[k].s.trim())) continue;
    const start = items[k];
    // Join the wrapped pieces of this block: same column, until the next block starts.
    let text = start.s.trim();
    let j = k + 1;
    for (; j < items.length; j++) {
      const it = items[j];
      if (it.page !== start.page || Math.abs(colOf(it) - colOf(start)) > 3 || CELCAT_START.test(it.s.trim())) break;
      text += (/[:\-(]$/.test(text) ? "" : " ") + it.s.trim();
    }
    k = j - 1;

    const m = new RegExp(String.raw`^(.+?),\s*(${CELCAT_TIME})\s*-\s*(${CELCAT_TIME})\s*(.*)$`, "i").exec(text);
    const code = m?.[4].match(/Module:\s*([A-Za-z]{2,6}\s?\d{3,5}[A-Za-z]?)/i)?.[1].replace(/\s+/g, "").toUpperCase();
    if (!m || !code) { warnings.push(`Could not read a class: "${text.slice(0, 60)}"`); continue; }
    const starts_at = to24(m[2]), ends_at = to24(m[3]);
    if (!starts_at || !ends_at || ends_at <= starts_at) { warnings.push(`${code}: unreadable or impossible time "${m[2]}-${m[3]}".`); continue; }
    const weekday = dayAt(start);
    if (!weekday) { warnings.push(`${code}: could not tell which day it is on.`); continue; }
    const rest = m[4];
    const staff = /Staff:\s*(.*?)(?=\s+(?:Rooms?|Groups?|Module|Notes?):|$)/i.exec(rest)?.[1].trim() || null;
    const roomsRaw = /Rooms?:\s*(.*?)(?=\s+(?:Staff|Groups?|Module|Notes?):|$)/i.exec(rest)?.[1].trim() ?? "";
    const r = roomsRaw ? parseRooms(roomsRaw) : { online: true, alsoOnline: false, venue: null, building: null, room: null, capacity: null };
    const c: ParsedClass = {
      code, weekday, starts_at, ends_at, online: r.online, building: r.building, room: r.room, venue: r.venue,
      lecturer: staff ? staff.split(/[;,]/)[0].trim().toUpperCase() : null,
      capacity: r.capacity, group: r.online ? "Online" : r.alsoOnline ? "Also online" : null, kind: kindOf(m[1]),
    };
    const key = [c.code, c.weekday, c.starts_at, c.ends_at, c.venue ?? "online"].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    classes.push(c);
  }
  classes.sort((a, b) => a.weekday - b.weekday || a.starts_at.localeCompare(b.starts_at) || a.code.localeCompare(b.code));
  if (!classes.length) warnings.push("No classes were found in this timetable.");
  return { title, expected: null, classes, warnings };
}
