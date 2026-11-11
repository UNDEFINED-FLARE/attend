"use server";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { findLecturerByName } from "@/lib/assignment-match";
import { requireRole } from "@/lib/auth";
import { extractPdfItems, parseTimetableItems, SCANNED_PDF, type ParsedClass, type ParsedTimetable } from "@/lib/timetable-pdf";
import { sourceCatalog, sourceClasses, type SourceItem, type SourceType } from "@/lib/timetable-sources";

type S = { error?: string; ok?: string } | undefined;

export type ImportPreview = {
  title: string | null; expected: number | null; classes: ParsedClass[]; warnings: string[];
  newModules: string[]; newVenues: string[]; lecturers: Record<string, boolean>;
};
export type PreviewState = { error?: string; preview?: ImportPreview } | undefined;

// The institution always comes from the admin's own role, never from the form.
const ctx = () => requireRole("institution_admin");

const ClassRow = z.object({
  code: z.string().regex(/^[A-Z]{2,6}\d{3,5}[A-Z]?$/),
  weekday: z.number().int().min(1).max(7),
  starts_at: z.string().regex(/^\d{2}:\d{2}$/),
  ends_at: z.string().regex(/^\d{2}:\d{2}$/),
  online: z.boolean(),
  building: z.string().max(120).nullable().optional(),
  room: z.string().max(120).nullable().optional(),
  venue: z.string().trim().min(1).max(120).nullable(),
  lecturer: z.string().trim().max(200).nullable(),
  group: z.string().trim().max(40).nullable().optional(),
  capacity: z.number().int().positive().max(10000).nullable().optional(),
  students: z.number().int().min(0).max(100000).nullable().optional(),
  sourceId: z.number().int().optional(),
  kind: z.enum(["lecture", "tutorial", "practical", "test", "other"]).optional(),
});
const MAX_CLASSES = 20000;
/** "CSC 111" typed on the Modules page is the timetable's "CSC111". */
const codeKey = (c: string) => c.toUpperCase().replace(/\s+/g, "");

/** What would be created, compared with what the institution already has. */
async function buildPreview(parsed: Omit<ParsedTimetable, "classes"> & { classes: ParsedClass[] }): Promise<PreviewState> {
  const { supabase, institutionId } = await ctx();
  const codes = [...new Set(parsed.classes.map((c) => c.code))];
  const venues = [...new Set(parsed.classes.map((c) => c.venue).filter(Boolean) as string[])];
  const names = [...new Set(parsed.classes.map((c) => c.lecturer).filter(Boolean) as string[])];
  const [{ data: mods }, { data: vens }, { data: lects }] = await Promise.all([
    supabase.from("modules").select("code").eq("institution_id", institutionId).is("deleted_at", null),
    supabase.from("venues").select("name").eq("institution_id", institutionId).is("deleted_at", null),
    supabase.from("lecturers").select("full_name").eq("institution_id", institutionId).is("deleted_at", null),
  ]);
  const haveMod = new Set((mods ?? []).map((m) => codeKey(m.code)));
  const haveVen = new Set((vens ?? []).map((v) => v.name.toLowerCase()));
  return {
    preview: {
      title: parsed.title, expected: parsed.expected, classes: parsed.classes, warnings: parsed.warnings,
      newModules: codes.filter((c) => !haveMod.has(codeKey(c))).sort(),
      newVenues: venues.filter((v) => !haveVen.has(v.toLowerCase())).sort(),
      // Same matching as the import itself, so "already registered" is what will happen.
      lecturers: Object.fromEntries(names.map((n) => [n, findLecturerByName(n, lects ?? []) !== null])),
    },
  };
}

// ------------------------------------------------------------------ from a PDF

/** Read the PDF and show what would be created. Writes nothing. */
export async function previewTimetablePdf(_: PreviewState, f: FormData): Promise<PreviewState> {
  const file = f.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose the timetable PDF." };
  if (file.size > 5 * 1024 * 1024) return { error: "That file is larger than 5 MB." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") return { error: "That file is not a PDF." };
  let parsed: ParsedTimetable;
  try {
    const items = await extractPdfItems(bytes);
    if (!items.length) return { error: SCANNED_PDF };
    parsed = parseTimetableItems(items);
  } catch (e) {
    return { error: e instanceof Error && /20 pages/.test(e.message) ? e.message : "That PDF could not be read. Export the timetable again and retry." };
  }
  if (!parsed.classes.length) return { error: parsed.warnings[0] ?? "No classes found in that PDF." };
  return buildPreview(parsed);
}

// ------------------------------------- from the institution's timetable source

/** The source the platform administrator set for this institution. Never taken from the browser. */
async function institutionSource(): Promise<{ type: SourceType; url: string } | null> {
  const { supabase, institutionId } = await ctx();
  const { data } = await supabase.from("institution_settings").select("*").eq("institution_id", institutionId).maybeSingle();
  const row = data as { timetable_source_type?: SourceType; timetable_source_url?: string | null } | null;
  if (!row?.timetable_source_type || row.timetable_source_type === "none" || !row.timetable_source_url) return null;
  return { type: row.timetable_source_type, url: row.timetable_source_url };
}

/** What can be imported: programmes from a timetable viewer, or PDF files from the timetable pages. */
export async function listSourceItems(): Promise<{ items?: SourceItem[]; type?: SourceType; error?: string }> {
  const src = await institutionSource();
  if (!src) return { error: "No timetable source is set up for your institution yet. Ask UniAttend to connect it." };
  try {
    const items = await sourceCatalog(src.type, src.url);
    return items.length ? { items, type: src.type } : { error: "The timetable source didn't list any timetables." };
  } catch (e) {
    return { error: e instanceof Error && e.message.length < 140 ? `Couldn't read the timetable source: ${e.message}` : "The timetable source did not respond. Try again in a minute." };
  }
}

/** One batch (the browser calls this repeatedly, so no request runs long). Ids are re-checked against the source. */
export async function fetchSourceBatch(ids: string[]): Promise<{ classes: ParsedClass[]; failed: string[] }> {
  const clean = z.array(z.string().min(1).max(500)).max(10).parse(ids);
  const src = await institutionSource();
  if (!src) return { classes: [], failed: clean };
  return sourceClasses(src.type, src.url, clean);
}

/** Preview classes gathered from the site. Re-validated: they came back through the browser. */
export async function previewClasses(classesJson: string, title: string): Promise<PreviewState> {
  let classes: ParsedClass[];
  try {
    const r = z.array(ClassRow).min(1).max(MAX_CLASSES).safeParse(JSON.parse(classesJson));
    if (!r.success) return { error: "No usable classes were found for those programmes." };
    classes = r.data as ParsedClass[];
  } catch { return { error: "Fetch the timetables again." }; }
  classes.sort((a, b) => a.weekday - b.weekday || a.starts_at.localeCompare(b.starts_at) || a.code.localeCompare(b.code));
  return buildPreview({ title: title.slice(0, 120), expected: null, classes, warnings: [] });
}

// ----------------------------------------------------------------------- apply

const errText = (e: { message: string; code?: string }) =>
  e.code === "PGRST204" || e.code === "42703"
    ? "The database needs its latest update: run supabase/migrations/20261109000008_timetable_details.sql in the Supabase SQL Editor, then try again."
    : e.code === "P0001" || e.code === "23P01" ? e.message : e.code === "23505" ? "Something with that name already exists." : e.message;

/** "THEMBA MARVIN MAKHUBELE" -> "Themba Marvin Makhubele" */
const nameCase = (n: string) => n.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, p, c) => p + c.toUpperCase());
/** Stable placeholder staff number for a lecturer known only by name; admins replace it later. */
const placeholderStaffNo = (n: string) => "TT-" + createHash("sha1").update(n.toUpperCase()).digest("hex").slice(0, 8).toUpperCase();

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

const DAY = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Create missing modules/venues, then the classes. */
export async function applyTimetableImport(_: S, f: FormData): Promise<S> {
  // The preview came back through the browser, so every field is validated again.
  let classes: z.infer<typeof ClassRow>[];
  try {
    const r = z.array(ClassRow).min(1).max(MAX_CLASSES).safeParse(JSON.parse(String(f.get("classes") ?? "[]")));
    if (!r.success) return { error: "The timetable data was not valid. Read the timetable again." };
    classes = r.data.filter((c) => c.ends_at > c.starts_at);
  } catch { return { error: "Read the timetable again." }; }
  const opt = (k: string) => f.get(k) === "on";
  const { supabase, institutionId, user } = await ctx();
  const notes: string[] = [];

  // Modules: match by code; create the missing ones if asked.
  const codes = [...new Set(classes.map((c) => c.code))];
  const { data: mods } = await supabase.from("modules").select("id, code").eq("institution_id", institutionId).is("deleted_at", null);
  const modId = new Map((mods ?? []).map((m) => [codeKey(m.code), m.id as string]));
  const missingMods = codes.filter((c) => !modId.has(codeKey(c)));
  // Class size per module: the sum of its distinct groups' sizes.
  const groupSizes = new Map<string, Map<string, number>>();
  for (const c of classes) if (c.students) {
    const g = groupSizes.get(c.code) ?? new Map<string, number>();
    g.set(c.group ?? "all", Math.max(g.get(c.group ?? "all") ?? 0, c.students));
    groupSizes.set(c.code, g);
  }
  const size = (code: string) => { const g = groupSizes.get(code); return g ? [...g.values()].reduce((a, b) => a + b, 0) : null; };
  if (missingMods.length && opt("create_modules")) {
    for (const part of chunks(missingMods, 500)) {
      const { data, error } = await supabase.from("modules")
        .insert(part.map((code) => ({ institution_id: institutionId, code, title: code, ...(size(code) ? { expected_students: size(code) } : {}) }))).select("id, code");
      if (error) return { error: errText(error) };
      for (const m of data ?? []) modId.set(codeKey(m.code), m.id);
    }
    notes.push(`${missingMods.length} modules created (give them proper titles on the Modules page)`);
  } else if (missingMods.length) {
    notes.push(`skipped ${missingMods.length} modules that don't exist yet`);
  }
  if (opt("module_sizes") && groupSizes.size) {
    let updated = 0;
    for (const code of codes) {
      const id = modId.get(code), n = size(code);
      if (!id || !n || missingMods.includes(code)) continue;
      const { error } = await supabase.from("modules").update({ expected_students: n }).eq("id", id).eq("institution_id", institutionId);
      if (error) return { error: errText(error) };
      updated++;
    }
    if (updated) notes.push(`class sizes updated on ${updated} existing modules`);
  }

  // Lecturers: find the registered one each timetable name means. Timetables print names
  // without titles ("THANDI MOKOENA" for "Dr Thandi Mokoena"), so an exact match would
  // register the same person twice. Create only the names that fit nobody.
  const lecturerNames = [...new Set(classes.map((c) => c.lecturer).filter(Boolean) as string[])];
  const { data: lectRows } = await supabase.from("lecturers").select("id, full_name, staff_number, deleted_at").eq("institution_id", institutionId);
  const active = (lectRows ?? []).filter((l) => !l.deleted_at) as { id: string; full_name: string }[];
  const takenStaffNo = new Set((lectRows ?? []).map((l) => l.staff_number));
  const lectId = new Map<string, string>(); // timetable name (upper case) -> lecturer id
  const unsure: string[] = [];
  for (const n of lecturerNames) {
    const hit = findLecturerByName(n, active);
    if (hit === "ambiguous") unsure.push(nameCase(n));
    else if (hit) lectId.set(n.toUpperCase(), hit.id);
  }
  const newLects = lecturerNames.filter((n) => !lectId.has(n.toUpperCase()) && !unsure.includes(nameCase(n)) && !takenStaffNo.has(placeholderStaffNo(n)));
  if (newLects.length && opt("create_lecturers")) {
    for (const part of chunks(newLects, 500)) {
      const { data, error } = await supabase.from("lecturers")
        .insert(part.map((n) => ({ institution_id: institutionId, full_name: nameCase(n), staff_number: placeholderStaffNo(n), source: "timetable" })))
        .select("id, staff_number");
      if (error) return { error: errText(error) };
      const byStaff = new Map((data ?? []).map((l) => [l.staff_number as string, l.id as string]));
      for (const n of part) { const id = byStaff.get(placeholderStaffNo(n)); if (id) lectId.set(n.toUpperCase(), id); }
    }
    notes.push(`${newLects.length} lecturer${newLects.length === 1 ? "" : "s"} created from the timetable (add their staff numbers and emails under People so they can sign in)`);
  }
  if (unsure.length) {
    notes.push(`${unsure.slice(0, 3).join(", ")}${unsure.length > 3 ? "…" : ""} could be more than one registered lecturer, so ${unsure.length === 1 ? "was" : "were"} not linked; assign ${unsure.length === 1 ? "them" : "these"} on the Modules page`);
  }

  // Venues: match by name; create the missing ones (not yet mapped) if asked.
  const capacity = new Map<string, number>();
  const buildingOf = new Map<string, string>();
  for (const c of classes) if (c.venue && c.building) buildingOf.set(c.venue.toLowerCase(), c.building.trim().toUpperCase());
  for (const c of classes) if (c.venue && c.capacity) capacity.set(c.venue.toLowerCase(), Math.max(capacity.get(c.venue.toLowerCase()) ?? 0, c.capacity));
  const names = [...new Set(classes.map((c) => c.venue).filter(Boolean) as string[])];
  const { data: vens } = await supabase.from("venues").select("id, name").eq("institution_id", institutionId).is("deleted_at", null);
  const venId = new Map((vens ?? []).map((v) => [v.name.toLowerCase(), v.id as string]));
  const venName = new Map((vens ?? []).map((v) => [v.id as string, v.name as string]));
  const missingVens = names.filter((n) => !venId.has(n.toLowerCase()));
  if (missingVens.length && opt("create_venues")) {
    for (const part of chunks(missingVens, 500)) {
      const { data, error } = await supabase.from("venues")
        .insert(part.map((name) => ({ institution_id: institutionId, name, capacity: capacity.get(name.toLowerCase()) ?? null, building: buildingOf.get(name.toLowerCase()) ?? null }))).select("id, name");
      if (error) return { error: errText(error) };
      for (const v of data ?? []) { venId.set(v.name.toLowerCase(), v.id); venName.set(v.id, v.name); }
    }
    notes.push(`${missingVens.length} venues created; map them on Venues & map so location checks work there`);
  }

  const moduleIds = [...new Set(classes.map((c) => modId.get(c.code)).filter(Boolean) as string[])];
  if (opt("replace")) {
    for (const part of chunks(moduleIds, 100)) {
      await supabase.from("timetables").delete().eq("institution_id", institutionId).in("module_id", part);
    }
  }

  // The whole current timetable, to skip duplicates and to check venue clashes in memory.
  const { data: existing } = await supabase.from("timetables").select("module_id, venue_id, weekday, starts_at, ends_at, modules(code)")
    .eq("institution_id", institutionId).limit(50000);
  const key = (m: string, v: string | null, d: number, s: string, e: string) => `${m}|${v ?? ""}|${d}|${s.slice(0, 5)}|${e.slice(0, 5)}`;
  const have = new Set((existing ?? []).map((t) => key(t.module_id, t.venue_id, t.weekday, t.starts_at, t.ends_at)));
  const booked = new Map<string, { s: string; e: string; code: string }[]>(); // venue|day -> slots
  const book = (v: string, d: number, s: string, e: string, code: string) => {
    const k = `${v}|${d}`;
    booked.set(k, [...(booked.get(k) ?? []), { s: s.slice(0, 5), e: e.slice(0, 5), code }]);
  };
  for (const t of existing ?? []) if (t.venue_id) book(t.venue_id, t.weekday, t.starts_at, t.ends_at, (t.modules as unknown as { code: string } | null)?.code ?? "");

  let already = 0;
  const clashes: string[] = [];
  const rows: Record<string, unknown>[] = [];
  for (const c of classes) {
    const module_id = modId.get(codeKey(c.code));
    if (!module_id) continue;
    const venue_id = c.venue ? venId.get(c.venue.toLowerCase()) ?? null : null;
    const k = key(module_id, venue_id, c.weekday, c.starts_at, c.ends_at);
    if (have.has(k)) { already++; continue; }
    if (venue_id) {
      const hit = (booked.get(`${venue_id}|${c.weekday}`) ?? []).find((b) => b.s < c.ends_at && c.starts_at < b.e);
      if (hit) {
        clashes.push(`${c.code} ${DAY[c.weekday]} ${c.starts_at} in ${venName.get(venue_id) ?? "venue"} overlaps ${hit.code} ${hit.s}–${hit.e}`);
        continue;
      }
      book(venue_id, c.weekday, c.starts_at, c.ends_at, c.code);
    }
    have.add(k);
    rows.push({ institution_id: institutionId, module_id, venue_id, weekday: c.weekday, starts_at: c.starts_at, ends_at: c.ends_at,
                kind: c.kind ?? "lecture", group_name: c.group ?? (c.online ? "Online" : null), created_by: user.id,
                lecturer_id: c.lecturer ? lectId.get(c.lecturer.toUpperCase()) ?? null : null });
  }

  // Batches of 500. The database still enforces the clash rule as a backstop.
  let added = 0;
  for (const part of chunks(rows, 500)) {
    const { error } = await supabase.from("timetables").insert(part);
    if (!error) { added += part.length; continue; }
    if (error.code === "PGRST204" || error.code === "42703") return { error: errText(error) };
    for (const r of part) {
      const { error: e } = await supabase.from("timetables").insert(r);
      if (e) clashes.push(errText(e)); else added++;
    }
  }

  // Link lecturers named in the timetable to their modules, where those lecturers exist.
  if (opt("assign_lecturers")) {
    const byName = lectId;
    const pairs = new Map<string, { institution_id: string; module_id: string; lecturer_id: string }>();
    for (const c of classes) {
      const m = modId.get(codeKey(c.code)), l = c.lecturer ? byName.get(c.lecturer.toUpperCase()) : undefined;
      if (m && l) pairs.set(`${m}|${l}`, { institution_id: institutionId, module_id: m, lecturer_id: l });
    }
    for (const part of chunks([...pairs.values()], 500)) {
      await supabase.from("lecturer_assignments").upsert(part, { onConflict: "module_id,lecturer_id", ignoreDuplicates: true });
    }
    if (pairs.size) notes.push(`${pairs.size} lecturers linked to their modules`);
  }

  revalidatePath("/admin/timetable");
  revalidatePath("/admin/modules");
  revalidatePath("/admin/structure");
  const summary = `${added} classes added${already ? `, ${already} were already on the timetable` : ""}${notes.length ? `; ${notes.join("; ")}` : ""}.`;
  return clashes.length
    ? { error: `${summary} ${clashes.length} not added because the venue was already booked: ${clashes.slice(0, 3).join("; ")}${clashes.length > 3 ? "…" : ""}` }
    : { ok: summary };
}
