"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { CampusSchema, type CampusInput } from "@/lib/campus-schema";
import { assertPublicHttps, sourceCatalog, type SourceType } from "@/lib/timetable-sources";

type S = { error?: string; ok?: string } | undefined;
const uuid = z.string().uuid();
const SOURCE_TYPES = ["none", "viewer_json", "pdf_links", "pdf_url"] as const;


const sourceUrl = z.union([z.literal(""), z.string().trim().max(500).regex(/^https:\/\/[^\s"'<>]+$/, "Timetable links must start with https://")]);

async function checkSource(type: (typeof SOURCE_TYPES)[number], url: string): Promise<string | null> {
  if (type === "none") return null;
  if (!url) return "Add the timetable link, or set the source to None.";
  try { await assertPublicHttps(url); return null; } catch (e) { return e instanceof Error ? e.message : "That link can't be used."; }
}

const err = (e: { message: string; code?: string }) =>
  e.code === "PGRST204" || e.code === "42703" || e.code === "42P01"
    ? "The database needs its latest update: run supabase/migrations/20261109000009_institution_setup.sql in the Supabase SQL Editor."
    : e.code === "23505" ? "An entry with that name already exists." : e.message;

// ------------------------------------------------------------------ directory

export async function saveDirectoryEntry(_: S, f: FormData): Promise<S> {
  const p = z.object({
    id: z.union([uuid, z.literal("")]),
    name: z.string().trim().min(2).max(200),
    short_name: z.string().trim().max(60),
    kind: z.enum(["university", "university_of_technology", "tvet_college", "college"]),
    province: z.string().trim().max(60),
    website: z.union([z.literal(""), z.string().trim().max(300).regex(/^https:\/\//, "Website must start with https://")]),
    timetable_source_type: z.enum(SOURCE_TYPES),
    timetable_source_url: sourceUrl,
    timetable_note: z.string().trim().max(500),
  }).safeParse(Object.fromEntries(f));
  if (!p.success) return { error: `${p.error.issues[0].path.join(".")}: ${p.error.issues[0].message}` };
  let campuses: CampusInput[];
  try {
    const r = z.array(CampusSchema).max(60).safeParse(JSON.parse(String(f.get("campuses") ?? "[]")));
    if (!r.success) return { error: `Campuses: ${r.error.issues[0].path.join(".")} ${r.error.issues[0].message}` };
    campuses = r.data.map((c) => ({ ...c, located: c.lat != null && c.lng != null }));
  } catch { return { error: "Campuses could not be read." }; }
  const bad = await checkSource(p.data.timetable_source_type, p.data.timetable_source_url);
  if (bad) return { error: bad };
  const { supabase } = await requireRole("super_admin");
  const { id, ...row } = p.data;
  const values = { ...row, short_name: row.short_name || null, province: row.province || null, website: row.website || null,
    timetable_source_url: row.timetable_source_url || null, timetable_note: row.timetable_note || null, campuses };
  const { error } = id
    ? await supabase.from("institution_directory").update(values).eq("id", id)
    : await supabase.from("institution_directory").insert(values);
  if (error) return { error: err(error) };
  revalidatePath("/super/directory");
  return { ok: "Saved." };
}

export async function deleteDirectoryEntry(_: S, f: FormData): Promise<S> {
  const id = uuid.safeParse(f.get("id"));
  if (!id.success) return { error: "Nothing to delete." };
  const { supabase } = await requireRole("super_admin");
  const { error } = await supabase.from("institution_directory").delete().eq("id", id.data);
  if (error) return { error: err(error) };
  revalidatePath("/super/directory");
  return { ok: "Removed from the directory." };
}

// --------------------------------------------------------- institution setup

/** Copy a directory entry's campuses and timetable source onto a registered institution. */
export async function applyDirectoryEntry(_: S, f: FormData): Promise<S> {
  const p = z.object({ institution_id: uuid, entry_id: uuid }).safeParse(Object.fromEntries(f));
  if (!p.success) return { error: "Choose a directory entry." };
  const { supabase } = await requireRole("super_admin");
  const { data: entry, error: e1 } = await supabase.from("institution_directory").select("*").eq("id", p.data.entry_id).maybeSingle();
  if (e1 || !entry) return { error: e1 ? err(e1) : "That directory entry no longer exists." };
  const camps = z.array(CampusSchema).parse(entry.campuses ?? []);
  const { data: existing } = await supabase.from("campuses").select("id, name").eq("institution_id", p.data.institution_id);
  const have = new Set((existing ?? []).map((c) => c.name.toLowerCase()));
  const rows = camps.filter((c) => !have.has(c.name.toLowerCase())).map((c) => ({
    institution_id: p.data.institution_id, name: c.name, town: c.town ?? null, lat: c.lat, lng: c.lng,
    zoom: c.zoom ?? 16, outline: c.outline ?? null, osm_ref: c.osm ?? null,
  }));
  if (rows.length) {
    const { error } = await supabase.from("campuses").insert(rows);
    if (error) return { error: err(error) };
  }
  const { error: e2 } = await supabase.from("institution_settings")
    .update({ timetable_source_type: entry.timetable_source_type, timetable_source_url: entry.timetable_source_url })
    .eq("institution_id", p.data.institution_id);
  if (e2) return { error: err(e2) };
  await supabase.from("institutions").update({ directory_id: entry.id }).eq("id", p.data.institution_id);
  revalidatePath(`/super/institutions/${p.data.institution_id}`);
  const located = rows.filter((r) => r.lat != null).length;
  return { ok: `Applied ${entry.name}: ${rows.length} campuses added (${located} on the map${rows.length - located ? `, ${rows.length - located} to place` : ""}), timetable source ${entry.timetable_source_type === "none" ? "not set (none known)" : "set"}.` };
}

/** Replace an institution's campus list with the edited one (by name: update, add, remove). */
export async function saveInstitutionCampuses(_: S, f: FormData): Promise<S> {
  const inst = uuid.safeParse(f.get("institution_id"));
  if (!inst.success) return { error: "Missing institution." };
  let camps: CampusInput[];
  try {
    const r = z.array(CampusSchema).max(60).safeParse(JSON.parse(String(f.get("campuses") ?? "[]")));
    if (!r.success) return { error: `Campuses: ${r.error.issues[0].path.join(".")} ${r.error.issues[0].message}` };
    camps = r.data;
  } catch { return { error: "Campuses could not be read." }; }
  const { supabase } = await requireRole("super_admin");
  const { data: existing } = await supabase.from("campuses").select("id, name").eq("institution_id", inst.data);
  const byName = new Map((existing ?? []).map((c) => [c.name.toLowerCase(), c.id as string]));
  const keep = new Set<string>();
  for (const c of camps) {
    const row = { name: c.name, town: c.town ?? null, lat: c.lat, lng: c.lng, zoom: c.zoom ?? 16, outline: c.outline ?? null, osm_ref: c.osm ?? null };
    const id = byName.get(c.name.toLowerCase());
    const { error } = id
      ? await supabase.from("campuses").update(row).eq("id", id)
      : await supabase.from("campuses").insert({ institution_id: inst.data, ...row });
    if (error) return { error: err(error) };
    if (id) keep.add(id);
  }
  // Removed from the list: hide, don't erase (venues may point at them).
  const gone = (existing ?? []).filter((c) => !keep.has(c.id) && !camps.some((x) => x.name.toLowerCase() === c.name.toLowerCase()));
  for (const c of gone) await supabase.from("campuses").update({ deleted_at: new Date().toISOString() }).eq("id", c.id);
  revalidatePath(`/super/institutions/${inst.data}`);
  return { ok: `Campuses saved${gone.length ? `; ${gone.length} removed` : ""}. The institution's maps open on them now.` };
}

export async function saveInstitutionSource(_: S, f: FormData): Promise<S> {
  const p = z.object({ institution_id: uuid, timetable_source_type: z.enum(SOURCE_TYPES), timetable_source_url: sourceUrl }).safeParse(Object.fromEntries(f));
  if (!p.success) return { error: p.error.issues[0].message };
  const bad = await checkSource(p.data.timetable_source_type, p.data.timetable_source_url);
  if (bad) return { error: bad };
  const { supabase } = await requireRole("super_admin");
  const { error } = await supabase.from("institution_settings").update({
    timetable_source_type: p.data.timetable_source_type,
    timetable_source_url: p.data.timetable_source_type === "none" ? null : p.data.timetable_source_url,
  }).eq("institution_id", p.data.institution_id);
  if (error) return { error: err(error) };
  revalidatePath(`/super/institutions/${p.data.institution_id}`);
  return { ok: "Timetable source saved. The institution's admins can import from it on their Timetable page." };
}

/** Try a source without saving anything: how many programmes or PDFs it lists. */
export async function testSource(_: S, f: FormData): Promise<S> {
  const p = z.object({ timetable_source_type: z.enum(SOURCE_TYPES), timetable_source_url: sourceUrl }).safeParse(Object.fromEntries(f));
  if (!p.success) return { error: p.error.issues[0].message };
  await requireRole("super_admin");
  if (p.data.timetable_source_type === "none") return { ok: "No source to test." };
  const bad = await checkSource(p.data.timetable_source_type, p.data.timetable_source_url);
  if (bad) return { error: bad };
  try {
    const items = await sourceCatalog(p.data.timetable_source_type as SourceType, p.data.timetable_source_url);
    if (!items.length) return { error: "The link worked, but no timetables were found there." };
    const what = p.data.timetable_source_type === "viewer_json" ? "programmes" : "PDF timetables";
    return { ok: `Works: ${items.length} ${what} found, e.g. ${items.slice(0, 3).map((i) => i.label).join(", ")}.` };
  } catch (e) {
    return { error: `Couldn't read it: ${e instanceof Error ? e.message : "no response"}` };
  }
}
