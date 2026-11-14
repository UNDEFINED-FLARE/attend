import "server-only";
import type { getSession } from "@/lib/auth";

// The admin Data page: one table per kind of record, with search, archived view,
// paging and CSV export. RLS limits everything to the admin's institution.

type Sb = NonNullable<Awaited<ReturnType<typeof getSession>>>["supabase"];
export type DataKind = "students" | "lecturers" | "modules" | "venues" | "timetable";
export type DataRow = { id: string; cells: Record<string, string | number | null>; archived: boolean; status?: string | null };
export type Column = { key: string; label: string; mono?: boolean };

export const PAGE_SIZE = 50;
const DAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const DATA: Record<DataKind, { label: string; singular: string; columns: Column[]; archive: boolean; deleteKind: string }> = {
  students: { label: "Students", singular: "student", archive: true, deleteKind: "student", columns: [
    { key: "student_number", label: "Student no.", mono: true }, { key: "full_name", label: "Name" }, { key: "email", label: "Email" },
    { key: "status", label: "Status" }, { key: "modules", label: "Modules" }, { key: "linked", label: "Account" }] },
  lecturers: { label: "Lecturers", singular: "lecturer", archive: true, deleteKind: "lecturer", columns: [
    { key: "staff_number", label: "Staff no.", mono: true }, { key: "full_name", label: "Name" }, { key: "email", label: "Email" },
    { key: "status", label: "Status" }, { key: "modules", label: "Modules" }, { key: "linked", label: "Account" }] },
  modules: { label: "Modules", singular: "module", archive: true, deleteKind: "module", columns: [
    { key: "code", label: "Code", mono: true }, { key: "title", label: "Title" }, { key: "department", label: "Department" },
    { key: "min_attendance_pct", label: "Required %" }, { key: "students", label: "Students" }, { key: "lecturers", label: "Lecturers" }] },
  venues: { label: "Venues", singular: "venue", archive: true, deleteKind: "venue", columns: [
    { key: "name", label: "Name" }, { key: "code", label: "Code", mono: true }, { key: "building", label: "Building" },
    { key: "capacity", label: "Capacity" }, { key: "mapped", label: "On the map" }] },
  timetable: { label: "Timetable", singular: "class", archive: false, deleteKind: "slot", columns: [
    { key: "module", label: "Module", mono: true }, { key: "day", label: "Day" }, { key: "time", label: "Time" },
    { key: "kind", label: "Kind" }, { key: "venue", label: "Venue" }, { key: "lecturer", label: "Lecturer" }] },
};

const like = (q: string) => `%${q.replace(/[%_,()]/g, " ").trim()}%`;

/** One page of a kind, or (with all=true) every row for export. */
export async function loadData(supabase: Sb, institutionId: string, kind: DataKind, opts: { q?: string; archived?: boolean; page?: number; all?: boolean }) {
  const q = (opts.q ?? "").trim().slice(0, 80);
  const from = opts.all ? 0 : ((opts.page ?? 1) - 1) * PAGE_SIZE;
  const to = opts.all ? 9999 : from + PAGE_SIZE - 1;
  const archivedFilter = <T extends { is: (c: string, v: null) => T; not: (c: string, o: string, v: null) => T }>(b: T) =>
    (opts.archived ? b.not("deleted_at", "is", null) : b.is("deleted_at", null));

  if (kind === "students" || kind === "lecturers") {
    const table = kind, num = kind === "students" ? "student_number" : "staff_number";
    const link = kind === "students" ? "module_enrolments(module_id)" : "lecturer_assignments(module_id)";
    let b = supabase.from(table).select(`id, ${num}, full_name, email, status, user_id, deleted_at, ${link}`, { count: "exact" })
      .eq("institution_id", institutionId).order(num);
    b = archivedFilter(b);
    if (q) b = b.or(`${num}.ilike.${like(q)},full_name.ilike.${like(q)},email.ilike.${like(q)}`);
    const { data, count, error } = await b.range(from, to);
    const rows: DataRow[] = ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
      id: r.id as string, archived: !!r.deleted_at, status: r.status as string,
      cells: { [num]: String(r[num] ?? "").replace(/~[0-9a-f]{8}$/, ""), full_name: r.full_name as string, email: (r.email as string) ?? "",
        status: r.status as string, modules: ((r[kind === "students" ? "module_enrolments" : "lecturer_assignments"] as unknown[]) ?? []).length,
        linked: r.user_id ? "Signed up" : "Not yet" },
    }));
    return { rows, count: count ?? 0, error: error?.message };
  }
  if (kind === "modules") {
    let b = supabase.from("modules").select("id, code, title, min_attendance_pct, deleted_at, departments(code), module_enrolments(student_id), lecturer_assignments(lecturer_id)", { count: "exact" })
      .eq("institution_id", institutionId).order("code");
    b = archivedFilter(b);
    if (q) b = b.or(`code.ilike.${like(q)},title.ilike.${like(q)}`);
    const { data, count, error } = await b.range(from, to);
    const rows: DataRow[] = ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
      id: r.id as string, archived: !!r.deleted_at,
      cells: { code: String(r.code).replace(/~[0-9a-f]{8}$/, ""), title: r.title as string, department: (r.departments as { code: string } | null)?.code ?? "",
        min_attendance_pct: (r.min_attendance_pct as number | null) ?? "default", students: (r.module_enrolments as unknown[]).length,
        lecturers: (r.lecturer_assignments as unknown[]).length },
    }));
    return { rows, count: count ?? 0, error: error?.message };
  }
  if (kind === "venues") {
    let b = supabase.from("venues").select("*", { count: "exact" }).eq("institution_id", institutionId).order("name");
    b = archivedFilter(b);
    if (q) b = b.or(`name.ilike.${like(q)},code.ilike.${like(q)}`);
    const { data, count, error } = await b.range(from, to);
    const rows: DataRow[] = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: r.id as string, archived: !!r.deleted_at,
      cells: { name: r.name as string, code: (r.code as string) ?? "", building: (r.building as string) ?? "", capacity: (r.capacity as number | null) ?? "",
        mapped: r.polygon ? "Outline" : r.lat != null ? "Point" : "No" },
    }));
    return { rows, count: count ?? 0, error: error?.message };
  }
  // timetable
  let b = supabase.from("timetables").select("id, weekday, starts_at, ends_at, kind, modules!inner(code), venues(name), lecturers(full_name)", { count: "exact" })
    .eq("institution_id", institutionId).order("weekday").order("starts_at");
  if (q) b = b.ilike("modules.code", like(q));
  let res = await b.range(from, to);
  if (res.error) {
    // lecturers on timetable slots need database update 0008
    let b2 = supabase.from("timetables").select("id, weekday, starts_at, ends_at, kind, modules!inner(code), venues(name)", { count: "exact" })
      .eq("institution_id", institutionId).order("weekday").order("starts_at");
    if (q) b2 = b2.ilike("modules.code", like(q));
    res = await b2.range(from, to) as typeof res;
  }
  const rows: DataRow[] = ((res.data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    id: r.id as string, archived: false,
    cells: { module: (r.modules as { code: string }).code, day: DAY[r.weekday as number], time: `${String(r.starts_at).slice(0, 5)}–${String(r.ends_at).slice(0, 5)}`,
      kind: r.kind as string, venue: (r.venues as { name: string } | null)?.name ?? "", lecturer: (r.lecturers as { full_name: string } | null)?.full_name ?? "" },
  }));
  return { rows, count: res.count ?? 0, error: res.error?.message };
}
