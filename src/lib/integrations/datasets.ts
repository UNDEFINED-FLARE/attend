// What each kind of academic data looks like to UniAttend, whatever the source calls
// its columns. One definition drives the import screens (which fields to map), the
// automatic column matching, and the rows sent to the sync engine (migration 0025).
// Pure functions only.

export type DatasetKey = "students" | "lecturers" | "modules" | "enrolments" | "assignments"
  | "faculties" | "departments" | "programmes" | "academic_periods" | "venues";

export type FieldDef = { key: string; label: string; required?: boolean; hint?: string; aliases: string[] };
export type DatasetDef = { key: DatasetKey; label: string; one: string; about: string; fields: FieldDef[]; needs?: string };

const EXT: FieldDef = { key: "external_id", label: "ID in your system", hint: "Your system's own permanent ID, if it has one. Lets a renumbered record stay the same record.",
  aliases: ["id", "external_id", "source_id", "sis_id", "record_id", "guid", "uuid"] };
const STATUS = (hint: string): FieldDef => ({ key: "status", label: "Status", hint, aliases: ["status", "reg_status", "registration_status", "state", "enrolment_status", "enrollment_status"] });
const MODULE_CODE: FieldDef = { key: "module_code", label: "Module code", required: true, aliases: ["module_code", "module", "course_code", "course", "subject_code", "subject", "class_code", "unit_code"] };

export const DATASETS: DatasetDef[] = [
  { key: "students", label: "Students", one: "student", about: "The student register: who studies at your institution.", fields: [
    { key: "student_number", label: "Student number", required: true, aliases: ["student_number", "student_no", "studentnumber", "student_id", "stud_no", "student", "number", "learner_number"] },
    { key: "full_name", label: "Full name", hint: "Or map first name and surname below.", aliases: ["full_name", "fullname", "name", "student_name", "names"] },
    { key: "first_name", label: "First name", aliases: ["first_name", "firstname", "first_names", "given_name", "forename", "initials"] },
    { key: "last_name", label: "Surname", aliases: ["last_name", "lastname", "surname", "family_name"] },
    { key: "email", label: "Email", hint: "The address they will sign up with.", aliases: ["email", "email_address", "e_mail", "student_email", "mail"] },
    STATUS("Registered, withdrawn, graduated or suspended. Empty means registered."),
    { key: "year_of_study", label: "Year of study", aliases: ["year_of_study", "year", "study_year", "level", "academic_level"] },
    { key: "programme_code", label: "Programme code", aliases: ["programme_code", "program_code", "qualification_code", "qualification", "programme", "degree_code"] },
    EXT,
  ] },
  { key: "lecturers", label: "Lecturers", one: "lecturer", about: "Teaching staff.", fields: [
    { key: "staff_number", label: "Staff number", required: true, aliases: ["staff_number", "staff_no", "staff_id", "employee_number", "employee_no", "emp_no", "persal", "number"] },
    { key: "full_name", label: "Full name", hint: "Or map first name and surname below.", aliases: ["full_name", "fullname", "name", "staff_name", "lecturer_name", "lecturer"] },
    { key: "first_name", label: "First name", aliases: ["first_name", "firstname", "given_name", "initials"] },
    { key: "last_name", label: "Surname", aliases: ["last_name", "lastname", "surname", "family_name"] },
    { key: "email", label: "Email", aliases: ["email", "email_address", "e_mail", "staff_email", "mail"] },
    { key: "department_code", label: "Department code", aliases: ["department_code", "dept_code", "department", "dept"] },
    STATUS("Active, left or suspended. Empty means active."),
    EXT,
  ] },
  { key: "modules", label: "Modules", one: "module", about: "The modules (courses) attendance is taken for.", fields: [
    { key: "code", label: "Module code", required: true, aliases: ["code", "module_code", "course_code", "subject_code", "module", "course"] },
    { key: "title", label: "Module name", required: true, aliases: ["title", "name", "module_name", "module_title", "course_name", "course_title", "description", "subject_name"] },
    { key: "department_code", label: "Department code", aliases: ["department_code", "dept_code", "department", "dept"] },
    { key: "period_name", label: "Academic period", hint: "Must match a period's name exactly, e.g. “2026 Semester 2”.", aliases: ["period_name", "period", "semester", "term", "academic_period", "academic_year"] },
    { key: "credits", label: "Credits", aliases: ["credits", "credit", "credit_value", "nqf_credits"] },
    EXT,
  ] },
  { key: "enrolments", label: "Enrolments", one: "enrolment", about: "Which student is registered for which module.", needs: "Students and modules must already exist.", fields: [
    { key: "student_number", label: "Student number", required: true, aliases: ["student_number", "student_no", "studentnumber", "student_id", "stud_no", "student"] },
    MODULE_CODE,
    { key: "period_name", label: "Academic period", aliases: ["period_name", "period", "semester", "term", "academic_period"] },
    STATUS("Registered or dropped. Empty means registered. A dropped enrolment is marked, never deleted."),
    EXT,
  ] },
  { key: "assignments", label: "Who teaches what", one: "teaching assignment", about: "Which lecturer teaches which module.", needs: "Lecturers and modules must already exist.", fields: [
    { key: "staff_number", label: "Staff number", hint: "Or map the lecturer's email.", aliases: ["staff_number", "staff_no", "staff_id", "employee_number", "emp_no", "lecturer_id"] },
    { key: "email", label: "Lecturer email", aliases: ["email", "email_address", "lecturer_email", "staff_email"] },
    MODULE_CODE,
    { key: "role", label: "Role", hint: "“assistant” or “tutor” for assistants; anything else is the main lecturer.", aliases: ["role", "type", "teaching_role"] },
    STATUS("Active or removed. Empty means active."),
  ] },
  { key: "faculties", label: "Faculties", one: "faculty", about: "The top of your academic structure.", fields: [
    { key: "code", label: "Faculty code", required: true, aliases: ["code", "faculty_code", "fac_code", "school_code"] },
    { key: "name", label: "Faculty name", required: true, aliases: ["name", "faculty_name", "faculty", "description", "school"] },
    EXT,
  ] },
  { key: "departments", label: "Departments", one: "department", about: "Departments within faculties.", needs: "Faculties must already exist.", fields: [
    { key: "code", label: "Department code", required: true, aliases: ["code", "department_code", "dept_code"] },
    { key: "name", label: "Department name", required: true, aliases: ["name", "department_name", "department", "dept_name", "description"] },
    { key: "faculty_code", label: "Faculty code", required: true, aliases: ["faculty_code", "fac_code", "faculty", "school_code"] },
    EXT,
  ] },
  { key: "programmes", label: "Programmes", one: "programme", about: "Qualifications students are registered for.", needs: "Departments must already exist.", fields: [
    { key: "code", label: "Programme code", required: true, aliases: ["code", "programme_code", "program_code", "qualification_code"] },
    { key: "name", label: "Programme name", required: true, aliases: ["name", "programme_name", "program_name", "qualification", "qualification_name", "description"] },
    { key: "department_code", label: "Department code", required: true, aliases: ["department_code", "dept_code", "department"] },
    EXT,
  ] },
  { key: "academic_periods", label: "Academic periods", one: "academic period", about: "Years, semesters, terms or blocks.", fields: [
    { key: "name", label: "Name", required: true, hint: "e.g. “2026 Semester 2”.", aliases: ["name", "period_name", "period", "semester", "term", "description"] },
    { key: "kind", label: "Kind", hint: "year, semester, term or block. Empty means semester.", aliases: ["kind", "type", "period_type"] },
    { key: "starts_on", label: "Starts on", required: true, hint: "A date.", aliases: ["starts_on", "start_date", "start", "from", "begin_date"] },
    { key: "ends_on", label: "Ends on", required: true, hint: "A date.", aliases: ["ends_on", "end_date", "end", "to", "finish_date"] },
    { key: "is_current", label: "Is the current period", hint: "yes / true / 1.", aliases: ["is_current", "current", "active"] },
    EXT,
  ] },
  { key: "venues", label: "Venues", one: "venue", about: "Lecture halls, labs and rooms. Map positions are set on the Venues & map page and never changed by an import.", fields: [
    { key: "name", label: "Venue name", required: true, aliases: ["name", "venue_name", "venue", "room", "room_name", "description"] },
    { key: "code", label: "Venue code", aliases: ["code", "venue_code", "room_code", "room_number"] },
    { key: "capacity", label: "Capacity", aliases: ["capacity", "seats", "size"] },
    { key: "building", label: "Building", aliases: ["building", "block", "building_name"] },
    EXT,
  ] },
];

/** How a run's status reads to an administrator: [label, badge tone]. */
export const RUN_STATUS: Record<string, [string, string]> = {
  staging: ["Waiting for you", "pending"], running: ["Running", "pending"], queued: ["Queued", "pending"],
  ok: ["Completed", "active"], warnings: ["Completed with warnings", "late"], failed: ["Failed", "absent"], cancelled: ["Cancelled", "closed"],
};

export const datasetDef = (key: string) => DATASETS.find((d) => d.key === key);

// ------------------------------------------------------------ mapping

export const TRANSFORMS = {
  none: "As it is",
  upper: "UPPERCASE",
  lower: "lowercase",
  nospace: "Remove spaces",
  digits: "Keep digits only",
  date_dmy: "Date: day/month/year",
  date_mdy: "Date: month/day/year",
} as const;
export type Transform = keyof typeof TRANSFORMS;

/** One destination field: a column of the file, or a fixed value for every row, optionally tidied. */
export type FieldMap = { column?: string; fixed?: string; transform?: Transform };
export type Mapping = Record<string, FieldMap>;

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/** A first guess at which column feeds which field, by name. Each column is used once. */
export function autoMap(headers: string[], dataset: DatasetDef): Mapping {
  const byNorm = new Map(headers.map((h) => [norm(h), h]));
  const used = new Set<string>();
  const out: Mapping = {};
  for (const f of dataset.fields) {
    const hit = f.aliases.map((a) => byNorm.get(norm(a))).find((h) => h && !used.has(h));
    if (hit) { out[f.key] = { column: hit }; used.add(hit); }
  }
  // Dates in a file are nearly always day-first in South Africa.
  for (const k of ["starts_on", "ends_on"]) if (out[k]) out[k].transform = "date_dmy";
  return out;
}

const pad = (n: string) => n.padStart(2, "0");
function toIsoDate(v: string, order: "dmy" | "mdy"): string {
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = /^(\d{1,2})[/.\- ](\d{1,2})[/.\- ](\d{2,4})$/.exec(s);
  if (!m) return s;                                // left as it is; the engine rejects it with a clear reason
  const [a, b] = order === "dmy" ? [m[1], m[2]] : [m[2], m[1]];
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${y}-${pad(b)}-${pad(a)}`;
}

export function applyTransform(v: string, t: Transform | undefined): string {
  switch (t) {
    case "upper": return v.toUpperCase();
    case "lower": return v.toLowerCase();
    case "nospace": return v.replace(/\s+/g, "");
    case "digits": return v.replace(/\D+/g, "");
    case "date_dmy": return toIsoDate(v, "dmy");
    case "date_mdy": return toIsoDate(v, "mdy");
    default: return v;
  }
}

/** Problems with a mapping that would make every row fail, in plain words. Empty means it can be used. */
export function mappingProblems(dataset: DatasetDef, mapping: Mapping, headers: string[]): string[] {
  const has = (k: string) => !!(mapping[k]?.column || mapping[k]?.fixed);
  const out: string[] = [];
  for (const f of dataset.fields) {
    const m = mapping[f.key];
    if (m?.column && !headers.includes(m.column)) out.push(`“${f.label}” points at a column (“${m.column}”) that isn't in this file.`);
    if (f.required && !has(f.key)) out.push(`Choose the column that holds “${f.label}”.`);
  }
  if ((dataset.key === "students" || dataset.key === "lecturers") && !has("full_name") && !(has("first_name") && has("last_name"))) {
    out.push("Choose the column for the full name, or both first name and surname.");
  }
  if (dataset.key === "assignments" && !has("staff_number") && !has("email")) out.push("Choose the column for the staff number or the lecturer's email.");
  return out;
}

/** Columns of the file that nothing uses, so they are reported instead of silently dropped. */
export function unusedColumns(mapping: Mapping, headers: string[]): string[] {
  const used = new Set(Object.values(mapping).map((m) => m.column).filter(Boolean));
  return headers.filter((h) => h.trim() && !used.has(h));
}

/** File rows → the engine's rows for this dataset. Rows that are entirely empty are skipped. */
export function mapRows(headers: string[], rows: string[][], dataset: DatasetDef, mapping: Mapping): Record<string, string>[] {
  const idx = new Map(headers.map((h, i) => [h, i]));
  const out: Record<string, string>[] = [];
  for (const row of rows) {
    if (!row.some((c) => (c ?? "").trim())) continue;
    const o: Record<string, string> = {};
    for (const f of dataset.fields) {
      const m = mapping[f.key];
      if (!m) continue;
      const raw = m.column !== undefined && idx.has(m.column) ? (row[idx.get(m.column)!] ?? "") : "";
      const v = applyTransform(String(raw).trim() || (m.fixed ?? "").trim(), m.transform);
      if (v) o[f.key] = v.slice(0, 500);
    }
    out.push(o);
  }
  return out;
}

/** A JSON file: a list of objects, or an object with one list inside. Returns it as a header row and cells. */
export function tableFromJson(raw: unknown): { headers: string[]; rows: string[][] } {
  let list: unknown = raw;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) list = Object.values(raw as object).find((v) => Array.isArray(v)) ?? [];
  const items = (Array.isArray(list) ? list : []).filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x));
  const headers = [...new Set(items.flatMap((x) => Object.keys(x)))];
  const cell = (v: unknown) => v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return { headers, rows: items.map((x) => headers.map((h) => cell(x[h]))) };
}
