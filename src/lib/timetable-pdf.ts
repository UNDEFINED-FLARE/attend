// Parser for timetable PDFs exported by the University of Venda "Timetable
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
    .replace(/\b(Lh|Ict|Uigc|Ems)\b/g, (w) => w.toUpperCase());
  const b = tidy(building), r = tidy(room);
  if (b.toLowerCase().includes(r.toLowerCase())) return b;
  return `${b} ${r}`;
}

export function parseTimetableItems(items: TextItem[]): ParsedTimetable {
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
