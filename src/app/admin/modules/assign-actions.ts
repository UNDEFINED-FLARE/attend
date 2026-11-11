"use server";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { matchAssignments, type AssignmentRow } from "@/lib/assignment-match";
import { requireRole } from "@/lib/auth";
import { documentRows } from "@/lib/doc-rows";

export type AssignPreview = { error?: string; file?: string; kind?: string; rows?: AssignmentRow[] };

// The institution always comes from the admin's own role, never from the form.
const ctx = () => requireRole("institution_admin");

/** Read the document and show the matches. Writes nothing. */
export async function previewAssignments(_: AssignPreview | undefined, f: FormData): Promise<AssignPreview> {
  const file = f.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file." };
  if (file.size > 5 * 1024 * 1024) return { error: "That file is larger than 5 MB." };
  let doc;
  try {
    doc = await documentRows(file.name, new Uint8Array(await file.arrayBuffer()));
  } catch (e) {
    return { error: e instanceof Error && /supported|pages|zip|Word|expands|scan/.test(e.message) ? e.message : "That file could not be read. Use PDF, Word (.docx), Excel (.xlsx) or CSV." };
  }
  const { supabase, institutionId } = await ctx();
  const [{ data: mods }, { data: lects }, { data: existing }] = await Promise.all([
    supabase.from("modules").select("id, code, title").eq("institution_id", institutionId).is("deleted_at", null),
    supabase.from("lecturers").select("id, full_name, staff_number, email").eq("institution_id", institutionId).is("deleted_at", null),
    supabase.from("lecturer_assignments").select("module_id, lecturer_id").eq("institution_id", institutionId),
  ]);
  const rows = matchAssignments(doc.rows.slice(0, 20000), mods ?? [], lects ?? [], existing ?? [], doc.pairs);
  if (!rows.length) return { error: "No module codes with lecturers were found in that file. It needs module codes (e.g. CSC101) and lecturer names, emails or staff numbers." };
  return { file: file.name, kind: doc.kind, rows: rows.slice(0, 3000) };
}

const Item = z.object({
  code: z.string().regex(/^[A-Z]{2,6}\d{3,5}[A-Z]?$/),
  lecturer_id: z.string().uuid().nullable(),
  lecturer_name: z.string().trim().min(2).max(200).nullable(),
  email: z.string().trim().toLowerCase().email().nullable().catch(null),
  staff_number: z.string().trim().max(32).nullable(),
  role: z.enum(["primary", "assistant"]),
  module_title: z.string().trim().max(200).nullable().optional().catch(null),
});
/** "CSC 111" and "csc111" are the same module. */
const codeKey = (c: string) => c.toUpperCase().replace(/\s+/g, "");

/** Stable placeholder staff number for a lecturer known only by name; admins replace it later. */
const placeholderStaffNo = (n: string) => "LA-" + createHash("sha1").update(n.toUpperCase()).digest("hex").slice(0, 8).toUpperCase();

export async function applyAssignments(_: { error?: string; ok?: string } | undefined, f: FormData): Promise<{ error?: string; ok?: string }> {
  let items: z.infer<typeof Item>[];
  try {
    items = z.array(Item).max(3000).parse(JSON.parse(String(f.get("items") ?? "[]")));
  } catch { return { error: "The selection could not be read. Preview the file again." }; }
  if (!items.length) return { error: "Tick at least one row." };
  const createLecturers = f.get("create_lecturers") === "on", createModules = f.get("create_modules") === "on";
  const { supabase, institutionId } = await ctx();
  const notes: string[] = [];

  // Modules by code, creating missing ones if allowed.
  const { data: mods } = await supabase.from("modules").select("id, code").eq("institution_id", institutionId).is("deleted_at", null);
  const modId = new Map((mods ?? []).map((m) => [codeKey(m.code), m.id as string]));
  const missingMods = [...new Set(items.map((i) => i.code).filter((c) => !modId.has(codeKey(c))))];
  if (missingMods.length && createModules) {
    // The module's name from the document when it had one, else the code (renamed later).
    const titleOf = (code: string) => items.find((i) => i.code === code && i.module_title && i.module_title !== code)?.module_title ?? code;
    const { data, error } = await supabase.from("modules").insert(missingMods.map((code) => ({ institution_id: institutionId, code, title: titleOf(code) })))
      .select("id, code, title");
    if (error) return { error: error.message };
    for (const m of data ?? []) modId.set(codeKey(m.code), m.id);
    const untitled = (data ?? []).filter((m) => m.title === m.code).length;
    notes.push(`${missingMods.length} module${missingMods.length === 1 ? "" : "s"} created${untitled ? ` (give ${untitled === 1 ? "it a title" : `${untitled} of them titles`} on this page)` : ""}`);
  }

  // Lecturers: existing ids, or found by email/staff number, or created if allowed.
  const { data: lects } = await supabase.from("lecturers").select("id, staff_number, email, full_name").eq("institution_id", institutionId);
  const known = new Set((lects ?? []).map((l) => l.id as string));
  const byEmail = new Map((lects ?? []).filter((l) => l.email).map((l) => [String(l.email).toLowerCase(), l.id as string]));
  const byStaff = new Map((lects ?? []).map((l) => [String(l.staff_number).toUpperCase(), l.id as string]));
  const resolve = (i: z.infer<typeof Item>) =>
    (i.lecturer_id && known.has(i.lecturer_id) ? i.lecturer_id : null)
    ?? (i.email ? byEmail.get(i.email) : undefined)
    ?? (i.staff_number ? byStaff.get(i.staff_number.toUpperCase()) : undefined)
    ?? (i.lecturer_name ? byStaff.get(placeholderStaffNo(i.lecturer_name)) : undefined) ?? null;

  const toCreate = new Map<string, { institution_id: string; full_name: string; staff_number: string; email: string | null }>();
  for (const i of items) {
    if (resolve(i) || !i.lecturer_name) continue;
    const staff = i.staff_number && !byStaff.has(i.staff_number.toUpperCase()) ? i.staff_number : placeholderStaffNo(i.lecturer_name);
    toCreate.set(staff.toUpperCase(), { institution_id: institutionId, full_name: i.lecturer_name, staff_number: staff, email: i.email });
  }
  if (toCreate.size && createLecturers) {
    const { data, error } = await supabase.from("lecturers").insert([...toCreate.values()]).select("id, staff_number, email");
    if (error) return { error: error.code === "23505" ? "A lecturer with one of those staff numbers or emails already exists. Preview again." : error.message };
    for (const l of data ?? []) {
      byStaff.set(String(l.staff_number).toUpperCase(), l.id);
      if (l.email) byEmail.set(String(l.email).toLowerCase(), l.id);
    }
    notes.push(`${toCreate.size} lecturers created (they get access when they sign up with their email; add missing emails under People)`);
  }

  const pairs = new Map<string, { institution_id: string; module_id: string; lecturer_id: string; role: string }>();
  const noModule = new Set<string>(), noLecturer = new Set<string>();
  for (const i of items) {
    const m = modId.get(codeKey(i.code)), l = resolve(i);
    if (!m) { noModule.add(i.code); continue; }
    if (!l) { noLecturer.add(i.lecturer_name ?? i.code); continue; }
    pairs.set(`${m}|${l}`, { institution_id: institutionId, module_id: m, lecturer_id: l, role: i.role });
  }
  if (pairs.size) {
    const { error } = await supabase.from("lecturer_assignments").upsert([...pairs.values()], { onConflict: "module_id,lecturer_id", ignoreDuplicates: true });
    if (error) return { error: error.message };
  }
  revalidatePath("/admin/modules");
  revalidatePath("/admin/people");
  // Say exactly what was left out and how to include it, rather than "N rows skipped".
  const list = (s: Set<string>) => [...s].slice(0, 5).join(", ") + (s.size > 5 ? "…" : "");
  const left = [
    noModule.size ? `not done for ${list(noModule)}: the module doesn't exist (tick "Create missing modules" to add it)` : "",
    noLecturer.size ? `not done for ${list(noLecturer)}: the lecturer isn't registered (tick "Create new lecturers" to add them)` : "",
  ].filter(Boolean);
  const msg = [`${pairs.size} lecturer assignment${pairs.size === 1 ? "" : "s"} saved`, ...notes, ...left].join(" · ") + ".";
  return pairs.size || !left.length ? { ok: msg } : { error: msg };
}
