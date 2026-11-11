"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { coveringRadius } from "@/lib/campuses";
import { csvRows, documentRows } from "@/lib/doc-rows";
import { friendlyImportError, studentRows, type StudentRow } from "@/lib/student-rows";

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
  // Database wording ("violates check constraint ...") means nothing to an administrator.
  if (e.code === "23514" || e.code === "22P02" || e.code === "22001") return { error: "One of the values isn't allowed or is too long. Check the form and try again." };
  if (e.code === "42501") return { error: "Your account isn't allowed to do that. Ask an administrator of your institution." };
  if (!e.code && /fetch|network|timed? ?out|did not answer/i.test(e.message)) return { error: "UniAttend couldn't be reached. Check your internet connection and try again." };
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

/** The institution's module codes, so a file's "csc 111" finds "CSC111". */
async function moduleCodes(): Promise<string[]> {
  const { supabase, institutionId } = await ctx();
  const { data } = await supabase.from("modules").select("code").eq("institution_id", institutionId).is("deleted_at", null);
  return (data ?? []).map((m) => m.code as string);
}

// Any student list a person is likely to have: Excel, CSV (comma or semicolon, as South
// African Excel saves it), Word or PDF. The heading row is found wherever it is.
export async function importStudents(_: S, f: FormData): Promise<S> {
  const file = f.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose the file with your student list." };
  if (file.size > 5 * 1024 * 1024) return { error: "The file is larger than 5 MB. Split it and import in parts." };
  let doc;
  try {
    doc = await documentRows(file.name, new Uint8Array(await file.arrayBuffer()));
  } catch (e) {
    return { error: e instanceof Error && /supported|pages|zip|Word|expands|scan/.test(e.message) ? e.message : "That file could not be read. Use Excel (.xlsx), CSV, Word (.docx) or PDF." };
  }
  const parsed = studentRows(doc.rows.slice(0, 20000), { modules: await moduleCodes() });
  if ("error" in parsed) return { error: parsed.error };
  return runImport(parsed.rows, "row");
}

// All three ways of adding students (one form, a pasted list, a file) go
// through import_students(), so validation, de-duplication against existing
// records, the student-number format and plan limits are identical.
async function runImport(rows: StudentRow[], unit: "row" | "line", single = false): Promise<S> {
  if (rows.length > 10000) return { error: "That is more than 10,000 students. Split the list and import it in parts." };
  const { supabase, institutionId } = await ctx();
  const { data, error } = await supabase.rpc("import_students", {
    p_inst: institutionId,
    p_rows: rows.map((r) => ({ student_number: r.student_number, full_name: r.full_name,
      ...(r.email ? { email: r.email } : {}), ...(r.module_code ? { module_code: r.module_code } : {}) })),
  });
  if (error) return fail(error) ?? { error: error.message };
  const r = data as { inserted: number; updated: number; enrolled: number; errors: { row: number; error: string }[] };
  revalidatePath("/admin/people");
  revalidatePath("/admin/modules");
  if (single) {
    if (r.errors.length) return { error: friendlyImportError(r.errors[0].error).replace(/^./, (c) => c.toUpperCase()) + "." };
    const what = r.inserted ? "Student added" : "Student already existed; details updated";
    return { ok: `${what}${r.enrolled ? ` and enrolled in ${r.enrolled} module${r.enrolled > 1 ? "s" : ""}` : ""}.` };
  }
  // e.row counts the rows sent (1-based); report the row of the person's own file.
  const errs = r.errors.slice(0, 8).map((e) => `${unit} ${rows[e.row - 1]?.line ?? e.row}: ${friendlyImportError(e.error)}`).join("; ");
  const msg = `${r.inserted} added, ${r.updated} updated, ${r.enrolled} enrolment${r.enrolled === 1 ? "" : "s"}.`;
  return r.errors.length ? { error: `${msg} ${r.errors.length} not imported — ${errs}${r.errors.length > 8 ? "…" : ""}` } : { ok: msg };
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
  const rows = modules.length ? modules.map((module_code) => ({ ...base, module_code, line: 1 })) : [{ ...base, line: 1 }];
  return runImport(rows, "line", true);
}

export async function pasteStudents(_: S, f: FormData): Promise<S> {
  const text = String(f.get("list") ?? "").trim();
  if (!text) return { error: "Paste at least one line." };
  if (text.length > 1_000_000) return { error: "That list is too long. Split it, or upload it as a file." };
  // Excel copies cells as tab-separated; typed lists use commas or semicolons. With a heading
  // row the columns may be in any order; without one they follow the order on the screen.
  const parsed = studentRows(csvRows(text), { modules: await moduleCodes(), defaultModule: String(f.get("module_code") ?? ""), pasted: true });
  if ("error" in parsed) return { error: parsed.error };
  return runImport(parsed.rows, "line");
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

// ---------------------------------------------- attendance statuses (0014)

export async function addAttendanceStatus(_: S, f: FormData): Promise<S> {
  const p = z.object({
    name: z.string().trim().min(2, "Name it (2–40 characters).").max(40),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    category: z.enum(["present", "late", "absent", "excused"]),
    description: z.string().trim().max(200).optional(),
  }).safeParse(Object.fromEntries(f));
  if (!p.success) return { error: p.error.issues[0].message };
  const { supabase, institutionId } = await ctx();
  const { error } = await supabase.from("attendance_statuses").insert({ institution_id: institutionId, ...p.data, description: p.data.description || null });
  revalidatePath("/admin/settings");
  if (error?.code === "23505") return { error: "There is already a status with that name." };
  return fail(error) ?? { ok: `"${p.data.name}" added. Lecturers can pick it in the register now.` };
}

export async function toggleAttendanceStatus(f: FormData) {
  const p = z.object({ id: uuid, active: z.enum(["true", "false"]) }).parse(Object.fromEntries(f));
  const { supabase, institutionId } = await ctx();
  await supabase.from("attendance_statuses").update({ active: p.active === "true" }).eq("id", p.id).eq("institution_id", institutionId);
  revalidatePath("/admin/settings");
}
