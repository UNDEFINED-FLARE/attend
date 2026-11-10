"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { coveringRadius } from "@/lib/campuses";
import { csvObjects, parseCsv } from "@/lib/csv";

type S = { error?: string; ok?: string } | undefined;
const uuid = z.string().uuid();
const optUuid = z.union([uuid, z.literal("")]).transform((v) => v || null);
// "" must be tested first: z.coerce.number() would turn it into 0.
const optNum = z.union([z.literal(""), z.coerce.number()]).transform((v) => (v === "" ? null : v));

// Every write below runs as the signed-in admin through RLS. The institution id
// comes from requireRole(), i.e. from the admin's own role row, not the form.
async function ctx() {
  return requireRole("institution_admin");
}

function fail(e: { message: string; code?: string } | null): S | null {
  if (!e) return null;
  if (e.code === "23505") return { error: "That already exists." };
  if (e.code === "23503") return { error: "That refers to something that does not exist in your institution." };
  return { error: e.message };
}

export async function addFaculty(_: S, f: FormData): Promise<S> {
  const p = z.object({ name: z.string().trim().min(2), code: z.string().trim().toUpperCase().min(1).max(20) }).safeParse(Object.fromEntries(f));
  if (!p.success) return { error: p.error.issues[0].message };
  const { supabase, institutionId } = await ctx();
  const { error } = await supabase.from("faculties").insert({ institution_id: institutionId, ...p.data });
  revalidatePath("/admin/structure");
  return fail(error) ?? { ok: "Faculty added." };
}

export async function addDepartment(_: S, f: FormData): Promise<S> {
  const p = z.object({ faculty_id: uuid, name: z.string().trim().min(2), code: z.string().trim().toUpperCase().min(1).max(20) }).safeParse(Object.fromEntries(f));
  if (!p.success) return { error: p.error.issues[0].message };
  const { supabase, institutionId } = await ctx();
  const { error } = await supabase.from("departments").insert({ institution_id: institutionId, ...p.data });
  revalidatePath("/admin/structure");
  return fail(error) ?? { ok: "Department added." };
}

export async function removeVenue(_: S, f: FormData): Promise<S> {
  const id = uuid.safeParse(f.get("id"));
  if (!id.success) return { error: "Choose a venue." };
  const { supabase, institutionId } = await ctx();
  // Soft delete: past sessions keep pointing at it, new sessions cannot pick it.
  const { error } = await supabase.from("venues").update({ deleted_at: new Date().toISOString() })
    .eq("id", id.data).eq("institution_id", institutionId);
  revalidatePath("/admin/structure");
  return fail(error) ?? { ok: "Venue removed." };
}

export async function saveVenue(_: S, f: FormData): Promise<S> {
  const p = z.object({
    id: optUuid,
    name: z.string().trim().min(2).max(120),
    code: z.string().trim().max(30),
    capacity: optNum,
    // "" would coerce to 0 (a point in the Atlantic), so require a value first.
    lat: z.string().min(1, "place the venue on the map").pipe(z.coerce.number().min(-90).max(90)),
    lng: z.string().min(1, "place the venue on the map").pipe(z.coerce.number().min(-180).max(180)),
    radius_m: z.coerce.number().int().min(5).max(2000),
    polygon: z.string().trim().max(40000),
  }).safeParse(Object.fromEntries(f));
  if (!p.success) return { error: `Check the venue details: ${p.error.issues[0].path.join(".")} ${p.error.issues[0].message}` };
  let polygon: [number, number][] | null = null;
  if (p.data.polygon) {
    const parsed = z.array(z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)])).min(3).max(500)
      .safeParse((() => { try { return JSON.parse(p.data.polygon); } catch { return null; } })());
    if (!parsed.success) return { error: "The outline needs at least 3 corners." };
    polygon = parsed.data;
  }
  const { supabase, institutionId } = await ctx();
  const row = {
    name: p.data.name, code: p.data.code || null, capacity: p.data.capacity,
    lat: p.data.lat, lng: p.data.lng, radius_m: p.data.radius_m, polygon,
  };
  const { error } = p.data.id
    ? await supabase.from("venues").update(row).eq("id", p.data.id).eq("institution_id", institutionId)
    : await supabase.from("venues").insert({ institution_id: institutionId, ...row });
  revalidatePath("/admin/structure");
  return fail(error) ?? { ok: p.data.id ? "Venue updated." : "Venue added." };
}

export async function addModule(_: S, f: FormData): Promise<S> {
  const p = z.object({
    code: z.string().trim().toUpperCase().min(2).max(20), title: z.string().trim().min(2).max(200),
    department_id: optUuid, min_attendance_pct: optNum,
  }).safeParse(Object.fromEntries(f));
  if (!p.success) return { error: p.error.issues[0].message };
  const { supabase, institutionId } = await ctx();
  const { error } = await supabase.from("modules").insert({ institution_id: institutionId, ...p.data });
  revalidatePath("/admin/modules");
  return fail(error) ?? { ok: "Module created." };
}

export async function assignLecturer(_: S, f: FormData): Promise<S> {
  const p = z.object({ module_id: uuid, lecturer_id: uuid, role: z.enum(["primary", "assistant"]) }).safeParse(Object.fromEntries(f));
  if (!p.success) return { error: "Choose a module and a lecturer." };
  const { supabase, institutionId } = await ctx();
  const { error } = await supabase.from("lecturer_assignments").insert({ institution_id: institutionId, ...p.data });
  revalidatePath("/admin/modules");
  return fail(error) ?? { ok: "Lecturer assigned." };
}

export async function addLecturer(_: S, f: FormData): Promise<S> {
  const p = z.object({
    staff_number: z.string().trim().min(1).max(32), full_name: z.string().trim().min(2).max(200),
    email: z.string().trim().toLowerCase().email(), department_id: optUuid,
  }).safeParse(Object.fromEntries(f));
  if (!p.success) return { error: p.error.issues[0].message };
  const { supabase, institutionId } = await ctx();
  const { error } = await supabase.from("lecturers").insert({ institution_id: institutionId, ...p.data });
  revalidatePath("/admin/people");
  return fail(error) ?? { ok: "Lecturer added. They get access when they sign up with that email." };
}

export async function importStudents(_: S, f: FormData): Promise<S> {
  const file = f.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file." };
  if (file.size > 5 * 1024 * 1024) return { error: "The file is larger than 5 MB. Split it and import in parts." };
  if (!/\.csv$/i.test(file.name)) return { error: "Upload a .csv file (in Excel: File → Save As → CSV UTF-8)." };
  const rows = csvObjects(await file.text());
  if (!rows.length) return { error: "The file has no rows." };
  if (!("student_number" in rows[0]) || !("full_name" in rows[0])) {
    return { error: "The first row must have columns student_number and full_name (optional: email, module_code)." };
  }
  return runImport(rows as ImportRow[], 1); // +1: the header is line 1 of the file (columns checked above)
}

type ImportRow = { student_number: string; full_name: string; email?: string; module_code?: string };

// All three ways of adding students (one form, a pasted list, a CSV file) go
// through import_students(), so validation, de-duplication against existing
// records, the student-number format and plan limits are identical.
async function runImport(rows: ImportRow[], lineOffset: number, single = false): Promise<S> {
  const { supabase, institutionId } = await ctx();
  const { data, error } = await supabase.rpc("import_students", { p_inst: institutionId, p_rows: rows });
  if (error) return { error: error.message };
  const r = data as { inserted: number; updated: number; enrolled: number; errors: { row: number; error: string }[] };
  revalidatePath("/admin/people");
  revalidatePath("/admin/modules");
  if (single) {
    if (r.errors.length) return { error: r.errors[0].error.replace(/^./, (c) => c.toUpperCase()) + "." };
    const what = r.inserted ? "Student added" : "Student already existed; details updated";
    return { ok: `${what}${r.enrolled ? ` and enrolled in ${r.enrolled} module${r.enrolled > 1 ? "s" : ""}` : ""}.` };
  }
  const errs = r.errors.slice(0, 8).map((e) => `line ${e.row + lineOffset}: ${e.error}`).join("; ");
  const msg = `${r.inserted} added, ${r.updated} updated, ${r.enrolled} enrolments.`;
  return r.errors.length ? { error: `${msg} ${r.errors.length} skipped — ${errs}${r.errors.length > 8 ? "…" : ""}` } : { ok: msg };
}

export async function addStudent(_: S, f: FormData): Promise<S> {
  const p = z.object({
    student_number: z.string().trim().min(3, "Enter the student number.").max(32),
    full_name: z.string().trim().min(2, "Enter the student's full name.").max(200),
    email: z.union([z.literal(""), z.string().trim().toLowerCase().email("That email is not valid.")]),
  }).safeParse({ student_number: f.get("student_number"), full_name: f.get("full_name"), email: f.get("email") ?? "" });
  if (!p.success) return { error: p.error.issues[0].message };
  const modules = f.getAll("module_code").map(String).filter(Boolean);
  const base = { student_number: p.data.student_number, full_name: p.data.full_name, ...(p.data.email ? { email: p.data.email } : {}) };
  // One row per module; identical details on each row, so they merge into one student.
  const rows = modules.length ? modules.map((module_code) => ({ ...base, module_code })) : [base];
  return runImport(rows, 0, true);
}

export async function pasteStudents(_: S, f: FormData): Promise<S> {
  const text = String(f.get("list") ?? "").trim();
  if (!text) return { error: "Paste at least one line." };
  if (text.length > 1_000_000) return { error: "That list is too long. Split it, or upload a CSV file." };
  // Excel copies cells as tab-separated; typed lists use commas.
  const lines = parseCsv(text.includes("\t") ? text.replace(/\t/g, ",") : text);
  const hasHeader = /student|number|name/i.test(lines[0]?.join(" ") ?? "") && !/\d{4,}/.test(lines[0]?.[0] ?? "");
  const body = hasHeader ? lines.slice(1) : lines;
  const defaultModule = String(f.get("module_code") ?? "").trim();
  const rows: ImportRow[] = body.map(([number = "", name = "", email = "", module = ""]) => ({
    student_number: number.trim(), full_name: name.trim(),
    ...(email.trim() ? { email: email.trim() } : {}),
    ...((module.trim() || defaultModule) ? { module_code: module.trim() || defaultModule } : {}),
  }));
  if (!rows.length) return { error: "No students found in the list." };
  return runImport(rows, hasHeader ? 1 : 0);
}

export async function grantAdmin(_: S, f: FormData): Promise<S> {
  const email = z.string().trim().email().safeParse(f.get("email"));
  if (!email.success) return { error: "Enter an email." };
  const { supabase, institutionId } = await ctx();
  const { error } = await supabase.rpc("grant_role", { p_inst: institutionId, p_email: email.data, p_role: "institution_admin" });
  revalidatePath("/admin/people");
  return fail(error) ?? { ok: "Administrator added." };
}

export async function saveSettings(_: S, f: FormData): Promise<S> {
  const bool = z.preprocess((v) => v === "on", z.boolean());
  const p = z.object({
    min_attendance_pct: z.coerce.number().int().min(0).max(100),
    late_after_minutes: z.coerce.number().int().min(0).max(240),
    require_qr: bool, allow_manual_code: bool, require_gps: bool,
    gps_default_radius_m: z.coerce.number().int().min(10).max(2000),
    gps_max_accuracy_m: z.coerce.number().int().min(10).max(5000),
    accept_score: z.coerce.number().int().min(0).max(100),
    review_score: z.coerce.number().int().min(0).max(100),
    retention_days: z.coerce.number().int().min(30).max(3650),
  }).safeParse({
    ...Object.fromEntries(f),
    // unchecked boxes are absent from FormData
    require_qr: f.get("require_qr"), allow_manual_code: f.get("allow_manual_code"), require_gps: f.get("require_gps"),
  });
  if (!p.success) return { error: `${p.error.issues[0].path.join(".")}: ${p.error.issues[0].message}` };
  if (p.data.review_score > p.data.accept_score) return { error: "The review threshold cannot be above the accept threshold." };
  const { supabase, institutionId } = await ctx();
  const { error } = await supabase.from("institution_settings").update(p.data).eq("institution_id", institutionId);
  revalidatePath("/admin/settings");
  return fail(error) ?? { ok: "Policy saved." };
}

export async function saveBranding(_: S, f: FormData): Promise<S> {
  const p = z.object({
    name: z.string().trim().min(3).max(200),
    brand_primary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    student_number_pattern: z.string().trim().max(100),
  }).safeParse(Object.fromEntries(f));
  if (!p.success) return { error: p.error.issues[0].message };
  if (p.data.student_number_pattern) {
    try { new RegExp(p.data.student_number_pattern); } catch { return { error: "Student number format is not a valid pattern." }; }
  }
  const { supabase, institutionId } = await ctx();
  const { error } = await supabase.from("institutions").update({
    name: p.data.name, brand_primary: p.data.brand_primary, student_number_pattern: p.data.student_number_pattern || null,
  }).eq("id", institutionId);
  revalidatePath("/admin", "layout");
  return fail(error) ?? { ok: "Saved." };
}

const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export async function addTimetableSlots(_: S, f: FormData): Promise<S> {
  const p = z.object({
    module_id: uuid,
    venue_id: optUuid,
    kind: z.enum(["lecture", "tutorial", "practical", "test", "other"]),
    starts_at: z.string().regex(/^\d{2}:\d{2}$/, "Choose a start time."),
    ends_at: z.string().regex(/^\d{2}:\d{2}$/, "Choose an end time."),
    group_name: z.string().trim().max(40),
  }).safeParse(Object.fromEntries(f));
  if (!p.success) return { error: p.error.issues[0].message };
  if (p.data.ends_at <= p.data.starts_at) return { error: "The class must end after it starts." };
  const days = f.getAll("weekday").map(Number).filter((d) => d >= 1 && d <= 7);
  if (!days.length) return { error: "Tick at least one day." };
  const { supabase, institutionId, user } = await ctx();
  // One insert per day, so a clash on one day does not block the others.
  const done: string[] = [], clashes: string[] = [];
  for (const weekday of days) {
    const { error } = await supabase.from("timetables").insert({
      institution_id: institutionId, module_id: p.data.module_id, venue_id: p.data.venue_id, weekday,
      starts_at: p.data.starts_at, ends_at: p.data.ends_at, kind: p.data.kind,
      group_name: p.data.group_name || null, created_by: user.id,
    });
    if (error) clashes.push(error.message); else done.push(DAY_NAMES[weekday]);
  }
  revalidatePath("/admin/timetable");
  if (!clashes.length) return { ok: `Added on ${done.join(", ")}. Enrolled students see it on their timetable now.` };
  return { error: `${done.length ? `Added on ${done.join(", ")}. ` : ""}${clashes.join(" ")}` };
}

export async function removeTimetableSlot(f: FormData) {
  const id = uuid.parse(f.get("id"));
  const { supabase, institutionId } = await ctx();
  await supabase.from("timetables").delete().eq("id", id).eq("institution_id", institutionId);
  revalidatePath("/admin/timetable");
}

/** Auto-geofence: create many venues at once from building outlines picked on the map. */
export async function addVenuesBulk(_: S, f: FormData): Promise<S> {
  const Row = z.object({
    name: z.string().trim().min(2).max(120),
    polygon: z.array(z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)])).min(3).max(500),
  });
  let parsed: z.infer<typeof Row>[];
  try {
    const r = z.array(Row).min(1).max(200).safeParse(JSON.parse(String(f.get("venues") ?? "[]")));
    if (!r.success) return { error: "Tick at least one building with a name." };
    parsed = r.data;
  } catch { return { error: "Tick at least one building." }; }
  const { supabase, institutionId } = await ctx();
  const rows = parsed.map((v) => {
    const c: [number, number] = [
      +(v.polygon.reduce((a, p) => a + p[0], 0) / v.polygon.length).toFixed(6),
      +(v.polygon.reduce((a, p) => a + p[1], 0) / v.polygon.length).toFixed(6),
    ];
    return { institution_id: institutionId, name: v.name, lat: c[0], lng: c[1], polygon: v.polygon, radius_m: coveringRadius(c, v.polygon) };
  });
  const { error } = await supabase.from("venues").insert(rows);
  revalidatePath("/admin/structure");
  revalidatePath("/admin/timetable");
  return fail(error) ?? { ok: `${rows.length} venue${rows.length > 1 ? "s" : ""} created with their building outlines.` };
}

// ------------------------------------------------- campus location sharing (0013)

export async function saveLocationSettings(_: S, f: FormData): Promise<S> {
  const p = z.object({
    location_sharing_enabled: z.preprocess((v) => v === "on", z.boolean()),
    location_interval_s: z.coerce.number().int().min(15).max(900),
  }).safeParse({ ...Object.fromEntries(f), location_sharing_enabled: f.get("location_sharing_enabled") });
  if (!p.success) return { error: `${p.error.issues[0].path.join(".")}: ${p.error.issues[0].message}` };
  const { supabase, institutionId } = await ctx();
  const { error } = await supabase.from("institution_settings").update(p.data).eq("institution_id", institutionId);
  revalidatePath("/admin/live");
  return fail(error) ?? { ok: p.data.location_sharing_enabled ? "Campus location sharing is on." : "Campus location sharing is off." };
}
