"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { extractPdfItems, parseTimetableItems, type ParsedClass, type ParsedTimetable } from "@/lib/timetable-pdf";

type S = { error?: string; ok?: string } | undefined;

export type ImportPreview = {
  title: string | null; expected: number | null; classes: ParsedClass[]; warnings: string[];
  newModules: string[]; newVenues: string[]; lecturers: Record<string, boolean>;
};
export type PreviewState = { error?: string; preview?: ImportPreview } | undefined;

// The institution always comes from the admin's own role, never from the form.
const ctx = () => requireRole("institution_admin");

/** Step 1: read the PDF and show what would be created. Writes nothing. */
export async function previewTimetablePdf(_: PreviewState, f: FormData): Promise<PreviewState> {
  const file = f.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose the timetable PDF." };
  if (file.size > 5 * 1024 * 1024) return { error: "That file is larger than 5 MB." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") return { error: "That file is not a PDF." };
  let parsed: ParsedTimetable;
  try {
    parsed = parseTimetableItems(await extractPdfItems(bytes));
  } catch (e) {
    return { error: e instanceof Error && /20 pages/.test(e.message) ? e.message : "That PDF could not be read. Export the timetable again and retry." };
  }
  if (!parsed.classes.length) return { error: parsed.warnings[0] ?? "No classes found in that PDF." };

  const { supabase, institutionId } = await ctx();
  const codes = [...new Set(parsed.classes.map((c) => c.code))];
  const venues = [...new Set(parsed.classes.map((c) => c.venue).filter(Boolean) as string[])];
  const names = [...new Set(parsed.classes.map((c) => c.lecturer).filter(Boolean) as string[])];
  const [{ data: mods }, { data: vens }, { data: lects }] = await Promise.all([
    supabase.from("modules").select("code").eq("institution_id", institutionId).is("deleted_at", null),
    supabase.from("venues").select("name").eq("institution_id", institutionId).is("deleted_at", null),
    supabase.from("lecturers").select("full_name").eq("institution_id", institutionId).is("deleted_at", null),
  ]);
  const haveMod = new Set((mods ?? []).map((m) => m.code.toUpperCase()));
  const haveVen = new Set((vens ?? []).map((v) => v.name.toLowerCase()));
  const haveLect = new Set((lects ?? []).map((l) => l.full_name.trim().toUpperCase()));
  return {
    preview: {
      title: parsed.title, expected: parsed.expected, classes: parsed.classes, warnings: parsed.warnings,
      newModules: codes.filter((c) => !haveMod.has(c.toUpperCase())),
      newVenues: venues.filter((v) => !haveVen.has(v.toLowerCase())),
      lecturers: Object.fromEntries(names.map((n) => [n, haveLect.has(n.toUpperCase())])),
    },
  };
}

const ClassRow = z.object({
  code: z.string().regex(/^[A-Z]{2,6}\d{3,5}[A-Z]?$/),
  weekday: z.number().int().min(1).max(7),
  starts_at: z.string().regex(/^\d{2}:\d{2}$/),
  ends_at: z.string().regex(/^\d{2}:\d{2}$/),
  online: z.boolean(),
  venue: z.string().trim().min(1).max(120).nullable(),
  lecturer: z.string().trim().max(200).nullable(),
});

const errText = (e: { message: string; code?: string }) =>
  e.code === "P0001" || e.code === "23P01" ? e.message : e.code === "23505" ? "Something with that name already exists." : e.message;

/** Step 2: create missing modules/venues, then the classes. */
export async function applyTimetableImport(_: S, f: FormData): Promise<S> {
  // The preview came back through the browser, so every field is validated again.
  let classes: z.infer<typeof ClassRow>[];
  try {
    const r = z.array(ClassRow).min(1).max(2000).safeParse(JSON.parse(String(f.get("classes") ?? "[]")));
    if (!r.success) return { error: "The timetable data was not valid. Upload the PDF again." };
    classes = r.data.filter((c) => c.ends_at > c.starts_at);
  } catch { return { error: "Upload the PDF again." }; }
  const opt = (k: string) => f.get(k) === "on";
  const { supabase, institutionId, user } = await ctx();
  const notes: string[] = [];

  // Modules: match by code; create the missing ones if asked.
  const codes = [...new Set(classes.map((c) => c.code))];
  const { data: mods } = await supabase.from("modules").select("id, code").eq("institution_id", institutionId).is("deleted_at", null);
  const modId = new Map((mods ?? []).map((m) => [m.code.toUpperCase(), m.id as string]));
  const missingMods = codes.filter((c) => !modId.has(c));
  if (missingMods.length && opt("create_modules")) {
    const { data, error } = await supabase.from("modules")
      .insert(missingMods.map((code) => ({ institution_id: institutionId, code, title: code }))).select("id, code");
    if (error) return { error: errText(error) };
    for (const m of data ?? []) modId.set(m.code.toUpperCase(), m.id);
    notes.push(`${missingMods.length} modules created (give them proper titles on the Modules page)`);
  } else if (missingMods.length) {
    notes.push(`skipped ${missingMods.length} modules that don't exist yet: ${missingMods.join(", ")}`);
  }

  // Venues: match by name; create the missing ones (not yet mapped) if asked.
  const names = [...new Set(classes.map((c) => c.venue).filter(Boolean) as string[])];
  const { data: vens } = await supabase.from("venues").select("id, name").eq("institution_id", institutionId).is("deleted_at", null);
  const venId = new Map((vens ?? []).map((v) => [v.name.toLowerCase(), v.id as string]));
  const missingVens = names.filter((n) => !venId.has(n.toLowerCase()));
  if (missingVens.length && opt("create_venues")) {
    const { data, error } = await supabase.from("venues")
      .insert(missingVens.map((name) => ({ institution_id: institutionId, name }))).select("id, name");
    if (error) return { error: errText(error) };
    for (const v of data ?? []) venId.set(v.name.toLowerCase(), v.id);
    notes.push(`${missingVens.length} venues created; map them on Venues & map so location checks work there`);
  }

  const moduleIds = [...new Set(classes.map((c) => modId.get(c.code)).filter(Boolean) as string[])];
  if (opt("replace") && moduleIds.length) {
    await supabase.from("timetables").delete().eq("institution_id", institutionId).in("module_id", moduleIds);
  }
  const { data: existing } = await supabase.from("timetables").select("module_id, venue_id, weekday, starts_at, ends_at")
    .eq("institution_id", institutionId).in("module_id", moduleIds.length ? moduleIds : ["00000000-0000-0000-0000-000000000000"]);
  const key = (m: string, v: string | null, d: number, s: string, e: string) => `${m}|${v ?? ""}|${d}|${s.slice(0, 5)}|${e.slice(0, 5)}`;
  const have = new Set((existing ?? []).map((t) => key(t.module_id, t.venue_id, t.weekday, t.starts_at, t.ends_at)));

  let already = 0;
  const rows = classes.flatMap((c) => {
    const module_id = modId.get(c.code);
    if (!module_id) return [];
    const venue_id = c.venue ? venId.get(c.venue.toLowerCase()) ?? null : null;
    const k = key(module_id, venue_id, c.weekday, c.starts_at, c.ends_at);
    if (have.has(k)) { already++; return []; }
    have.add(k);
    return [{ institution_id: institutionId, module_id, venue_id, weekday: c.weekday, starts_at: c.starts_at, ends_at: c.ends_at,
              kind: "lecture", group_name: c.online ? "Online" : null, created_by: user.id }];
  });

  // One insert for speed; if a venue clash rejects the batch, go one by one to keep the rest.
  let added = 0;
  const clashes: string[] = [];
  if (rows.length) {
    const { error } = await supabase.from("timetables").insert(rows);
    if (!error) added = rows.length;
    else for (const r of rows) {
      const { error: e } = await supabase.from("timetables").insert(r);
      if (e) clashes.push(errText(e)); else added++;
    }
  }

  // Link lecturers named in the timetable to their modules, where those lecturers exist.
  if (opt("assign_lecturers")) {
    const { data: lects } = await supabase.from("lecturers").select("id, full_name").eq("institution_id", institutionId).is("deleted_at", null);
    const byName = new Map((lects ?? []).map((l) => [l.full_name.trim().toUpperCase(), l.id as string]));
    const pairs = new Map<string, { institution_id: string; module_id: string; lecturer_id: string }>();
    for (const c of classes) {
      const m = modId.get(c.code), l = c.lecturer ? byName.get(c.lecturer.toUpperCase()) : undefined;
      if (m && l) pairs.set(`${m}|${l}`, { institution_id: institutionId, module_id: m, lecturer_id: l });
    }
    if (pairs.size) {
      await supabase.from("lecturer_assignments").upsert([...pairs.values()], { onConflict: "module_id,lecturer_id", ignoreDuplicates: true });
      notes.push(`${pairs.size} lecturers linked to their modules`);
    }
  }

  revalidatePath("/admin/timetable");
  revalidatePath("/admin/modules");
  revalidatePath("/admin/structure");
  const summary = `${added} classes added${already ? `, ${already} were already on the timetable` : ""}${notes.length ? `; ${notes.join("; ")}` : ""}.`;
  return clashes.length
    ? { error: `${summary} ${clashes.length} not added because of venue clashes: ${clashes.slice(0, 3).join(" ")}${clashes.length > 3 ? "…" : ""}` }
    : { ok: summary };
}
