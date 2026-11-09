"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";

type S = { error?: string; ok?: string } | undefined;
const uuid = z.string().uuid();
const KINDS = ["student", "lecturer", "module", "faculty", "department", "enrolment", "assignment", "slot", "venue"] as const;
type Kind = (typeof KINDS)[number];

const PATHS: Record<Kind, string[]> = {
  student: ["/admin/people"], lecturer: ["/admin/people", "/admin/modules"], module: ["/admin/modules", "/admin/timetable"],
  faculty: ["/admin/structure"], department: ["/admin/structure"], enrolment: ["/admin/modules"], assignment: ["/admin/modules"],
  slot: ["/admin/timetable"], venue: ["/admin/structure", "/admin/timetable"],
};

/** Frees a unique number/code on an archived row so the same one can be added again later. */
const retired = (value: string, id: string, max: number) => `${value.slice(0, max - 10)}~${id.slice(0, 8)}`;

/**
 * Delete one record. Rows that attendance history depends on are archived
 * (hidden everywhere, history kept for reports) instead of erased; everything
 * else is deleted outright. RLS limits every statement to the admin's institution.
 */
export async function deleteRecord(_: S, f: FormData): Promise<S> {
  const p = z.object({ kind: z.enum(KINDS), id: uuid }).safeParse({ kind: f.get("kind"), id: f.get("id") });
  if (!p.success) return { error: "Nothing to delete." };
  const { kind, id } = p.data;
  const { supabase, institutionId } = await requireRole("institution_admin");
  const now = new Date().toISOString();
  const scoped = (table: string) => supabase.from(table).delete({ count: "exact" }).eq("id", id).eq("institution_id", institutionId);
  let msg = "Deleted.";

  if (kind === "student") {
    const { data: s } = await supabase.from("students").select("student_number, user_id").eq("id", id).eq("institution_id", institutionId).maybeSingle();
    if (!s) return { error: "That student no longer exists." };
    const { count } = await supabase.from("attendance_records").select("id", { count: "exact", head: true }).eq("student_id", id);
    if (count) {
      const { error } = await supabase.from("students").update({ deleted_at: now, status: "withdrawn", user_id: null, student_number: retired(s.student_number, id, 32) })
        .eq("id", id).eq("institution_id", institutionId);
      if (error) return { error: error.message };
      msg = `Archived: removed from every list, but their ${count} attendance records are kept for reports.`;
    } else {
      const { error } = await scoped("students");
      if (error) return { error: error.message };
    }
    if (s.user_id) await revokeRole(supabase, institutionId, s.user_id, "student");
  } else if (kind === "lecturer") {
    const { data: l } = await supabase.from("lecturers").select("staff_number, user_id").eq("id", id).eq("institution_id", institutionId).maybeSingle();
    if (!l) return { error: "That lecturer no longer exists." };
    const { count } = await supabase.from("class_sessions").select("id", { count: "exact", head: true }).eq("lecturer_id", id);
    if (count) {
      await supabase.from("lecturer_assignments").delete().eq("lecturer_id", id).eq("institution_id", institutionId);
      const { error } = await supabase.from("lecturers").update({ deleted_at: now, status: "left", user_id: null, staff_number: retired(l.staff_number, id, 40) })
        .eq("id", id).eq("institution_id", institutionId);
      if (error) return { error: error.message };
      msg = "Archived: removed from modules and lists; the sessions they ran stay in reports.";
    } else {
      const { error } = await scoped("lecturers");
      if (error) return { error: error.message };
    }
    if (l.user_id) await revokeRole(supabase, institutionId, l.user_id, "lecturer");
  } else if (kind === "module") {
    const { data: m } = await supabase.from("modules").select("code").eq("id", id).eq("institution_id", institutionId).maybeSingle();
    if (!m) return { error: "That module no longer exists." };
    const { count } = await supabase.from("class_sessions").select("id", { count: "exact", head: true }).eq("module_id", id);
    if (count) {
      await supabase.from("timetables").delete().eq("module_id", id).eq("institution_id", institutionId);
      const { error } = await supabase.from("modules").update({ deleted_at: now, code: retired(m.code, id, 40) }).eq("id", id).eq("institution_id", institutionId);
      if (error) return { error: error.message };
      msg = `Archived ${m.code}: off the timetable and lists; its ${count} past sessions stay in reports.`;
    } else {
      const { error } = await scoped("modules"); // enrolments, timetable and assignments go with it
      if (error) return { error: error.message };
      msg = `Deleted ${m.code} with its enrolments and timetable.`;
    }
  } else if (kind === "faculty" || kind === "department") {
    const table = kind === "faculty" ? "faculties" : "departments";
    const { error } = await scoped(table);
    if (error) {
      return { error: error.code === "23503"
        ? `This ${kind} still has ${kind === "faculty" ? "departments" : "modules, lecturers or programmes"} in it. Move or delete those first.`
        : error.message };
    }
  } else if (kind === "venue") {
    const { error } = await supabase.from("venues").update({ deleted_at: now }).eq("id", id).eq("institution_id", institutionId);
    if (error) return { error: error.message };
    await supabase.from("timetables").update({ venue_id: null }).eq("venue_id", id).eq("institution_id", institutionId);
    msg = "Venue removed; its timetable classes now show no venue.";
  } else {
    const table = kind === "enrolment" ? "module_enrolments" : kind === "assignment" ? "lecturer_assignments" : "timetables";
    const { error } = await scoped(table);
    if (error) return { error: error.message };
    msg = kind === "enrolment" ? "Student removed from the module." : kind === "assignment" ? "Lecturer removed from the module." : "Class removed from the timetable.";
  }
  PATHS[kind].forEach((path) => revalidatePath(path));
  return { ok: msg };
}

async function revokeRole(supabase: Awaited<ReturnType<typeof requireRole>>["supabase"], institutionId: string, userId: string, role: string) {
  const { data } = await supabase.from("user_roles").select("id").eq("institution_id", institutionId).eq("user_id", userId).eq("role", role).maybeSingle();
  if (data) await supabase.rpc("set_role_status", { p_role_id: data.id, p_status: "suspended" });
}

/** Enrol one student (by student number) in a module, or remove them. */
export async function changeEnrolment(_: S, f: FormData): Promise<S> {
  const p = z.object({
    module_id: uuid, student_number: z.string().trim().min(3, "Enter a student number.").max(32), op: z.enum(["add", "remove"]),
  }).safeParse(Object.fromEntries(f));
  if (!p.success) return { error: p.error.issues[0].message };
  const { supabase, institutionId } = await requireRole("institution_admin");
  const { data: s } = await supabase.from("students").select("id, full_name").eq("institution_id", institutionId)
    .ilike("student_number", p.data.student_number).is("deleted_at", null).maybeSingle();
  if (!s) return { error: "No student with that number. Add them under People first." };
  if (p.data.op === "add") {
    const { error } = await supabase.from("module_enrolments").upsert(
      { institution_id: institutionId, module_id: p.data.module_id, student_id: s.id, status: "active" }, { onConflict: "module_id,student_id" });
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("module_enrolments").delete().eq("module_id", p.data.module_id).eq("student_id", s.id).eq("institution_id", institutionId);
    if (error) return { error: error.message };
  }
  revalidatePath("/admin/modules");
  return { ok: `${s.full_name} ${p.data.op === "add" ? "enrolled" : "removed"}.` };
}

/** Edit a module's details. */
export async function updateModule(_: S, f: FormData): Promise<S> {
  const num = z.union([z.literal(""), z.coerce.number().int().min(0).max(100000)]).transform((v) => (v === "" ? null : v));
  const p = z.object({
    id: uuid, code: z.string().trim().toUpperCase().min(2).max(20), title: z.string().trim().min(2).max(200),
    department_id: z.union([uuid, z.literal("")]).transform((v) => v || null),
    min_attendance_pct: z.union([z.literal(""), z.coerce.number().int().min(0).max(100)]).transform((v) => (v === "" ? null : v)),
    expected_students: num,
  }).safeParse(Object.fromEntries(f));
  if (!p.success) return { error: `${p.error.issues[0].path.join(".")}: ${p.error.issues[0].message}` };
  const { id, expected_students, ...rest } = p.data;
  const { supabase, institutionId } = await requireRole("institution_admin");
  let { error } = await supabase.from("modules").update({ ...rest, expected_students }).eq("id", id).eq("institution_id", institutionId);
  if (error?.code === "PGRST204") ({ error } = await supabase.from("modules").update(rest).eq("id", id).eq("institution_id", institutionId));
  if (error) return { error: error.code === "23505" ? "Another module already uses that code." : error.message };
  revalidatePath("/admin/modules");
  return { ok: "Saved." };
}

/** Edit a lecturer or a student. */
export async function updatePerson(_: S, f: FormData): Promise<S> {
  const p = z.object({
    kind: z.enum(["student", "lecturer"]), id: uuid,
    number: z.string().trim().min(1).max(32), full_name: z.string().trim().min(2).max(200),
    email: z.union([z.literal(""), z.string().trim().toLowerCase().email("That email is not valid.")]),
  }).safeParse(Object.fromEntries(f));
  if (!p.success) return { error: p.error.issues[0].message };
  const { supabase, institutionId } = await requireRole("institution_admin");
  const row = p.data.kind === "student"
    ? { student_number: p.data.number.toUpperCase(), full_name: p.data.full_name, email: p.data.email || null }
    : { staff_number: p.data.number, full_name: p.data.full_name, email: p.data.email || null };
  const { error } = await supabase.from(p.data.kind === "student" ? "students" : "lecturers").update(row).eq("id", p.data.id).eq("institution_id", institutionId);
  if (error) return { error: error.code === "23505" ? "Someone else already has that number." : error.message };
  revalidatePath("/admin/people");
  return { ok: "Saved." };
}
