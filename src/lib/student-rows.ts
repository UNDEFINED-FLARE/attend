// Reads a student list out of rows of cells from any document (CSV, Excel, Word, PDF or a
// pasted list), the way a person would read it: find the heading row wherever it is, whatever
// the headings are called and in whatever order, and skip titles, totals and repeated headings.
// Pure (no database), so it can be unit-tested.

export type StudentRow = {
  student_number: string;
  full_name: string;
  email?: string;
  module_code?: string;
  /** Row of the source document this came from (1-based), for error messages. */
  line: number;
};

export type StudentRowsResult = { rows: StudentRow[]; ignored: number } | { error: string };

type Cols = { number: number; weak?: boolean; name?: number; first?: number; last?: number; email?: number; module?: number };

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9#]+/g, " ").trim();

// "Student number", "Student No.", "Stud no", "Student ID", "Matric no", "Registration number", "student_number"
const STRONG_NUMBER = /^(student|stud|std|learner)( (no|nr|num|number|id|code|#))+$|^(matric|matriculation|registration|reg|admission)( (no|nr|num|number))?$/;
// "Number", "No." — often just the row count, so only used when nothing better is there
const WEAK_NUMBER = /^(number|no|nr|num)$/;
const NOT_NUMBER = /\b(id number|identity|id no|staff|phone|cell|tel|mobile)\b/;
const FULL_NAME = /^(full ?names?|names?|student ?names?|learner ?names?|name (and|&) surname|names? (and|&) surname|surname (and|&) (first )?names?|student)$/;
const FIRST_NAME = /^(first ?names?|given ?names?|fore ?names?|first|names?|initials?)$/;
const SURNAME = /^(surname|last ?name|family ?name|last)$/;
const EMAIL = /\be ?mail\b/;
// Not plain "Course": in South Africa that is often the degree ("BSc Computer Science").
const MODULE = /^(module|subject)s?( codes?)?$|^course codes?$|^codes?$/;
const NO_EMAIL = /^(-+|n\/?a|none|nil|null)$/i;
const CODE_IN_TEXT = /[A-Za-z]{2,6}\s?\d{3,5}[A-Za-z]?/g;

/** The column layout if this row is a heading row, else null. */
export function studentHeader(cells: string[]): Cols | null {
  const w = cells.map(words);
  const find = (re: RegExp, skip: number[] = []) => w.findIndex((x, i) => x && !skip.includes(i) && re.test(x));
  const email = find(EMAIL);
  let number = w.findIndex((x, i) => i !== email && STRONG_NUMBER.test(x) && !NOT_NUMBER.test(x));
  const weak = number < 0;
  if (weak) number = w.findIndex((x, i) => i !== email && WEAK_NUMBER.test(x));
  if (number < 0) return null;
  const used = [number, email];
  const last = find(SURNAME, used);
  const cols: Cols = { number, ...(weak ? { weak } : {}) };
  if (email >= 0) cols.email = email;
  if (last >= 0) {
    const first = find(FIRST_NAME, [...used, last]);
    if (first < 0) return null;
    cols.first = first;
    cols.last = last;
  } else {
    const name = find(FULL_NAME, used);
    if (name < 0) return null;
    cols.name = name;
  }
  const mod = find(MODULE, [...used, last, cols.first ?? -1, cols.name ?? -1]);
  if (mod >= 0) cols.module = mod;
  return cols;
}

/** "20261001.0" (a number that went through a spreadsheet) -> "20261001". */
const tidyNumber = (s: string) => s.trim().replace(/^(\d+)\.0+$/, "$1");
const tidyName = (s: string) => s.replace(/\s+/g, " ").trim();
const codeKey = (s: string) => s.toUpperCase().replace(/\s+/g, "");

/**
 * @param rows      cells per row, as read from the document
 * @param modules   the institution's module codes, so "csc 111" in a file finds "CSC111"
 * @param defaultModule  used for rows without their own module
 * @param pasted    a list typed or pasted on the screen may leave out the headings (the screen
 *                  says which order to use); an uploaded file must have them, so a wrong file
 *                  (a timetable, a lecturer list) is refused instead of creating odd students
 */
export function studentRows(rows: string[][], opts: { modules?: string[]; defaultModule?: string; pasted?: boolean } = {}): StudentRowsResult {
  const known = new Map((opts.modules ?? []).map((c) => [codeKey(c), c]));
  // "CSC111; MAT101", "CSC 111 / MAT 101" -> one row per module. Text that isn't a code is passed
  // through as written, so the error names it the way the person typed it.
  const moduleCodes = (cell: string): string[] => {
    const found = cell.match(CODE_IN_TEXT);
    if (!found?.length) return [cell.trim()];
    return [...new Set(found.map((c) => known.get(codeKey(c)) ?? codeKey(c)))];
  };
  const fallbackModule = opts.defaultModule?.trim() ? known.get(codeKey(opts.defaultModule)) ?? opts.defaultModule.trim() : undefined;

  // The heading row is usually first, but PDFs and Word files often start with a title.
  let start = -1, cols: Cols | null = null;
  for (let i = 0; i < Math.min(rows.length, 25) && !cols; i++) {
    cols = studentHeader(rows[i] ?? []);
    if (cols) start = i;
  }
  if (!cols && !opts.pasted) {
    return { error: "This doesn't look like a student list: no headings such as Student number and Name were found. Check it's the right file, and that the list has a heading row." };
  }
  // A pasted list without headings: the order the screen describes (number, name, email, module).
  const positional = !cols;
  if (!cols) cols = { number: 0, name: 1, email: 2, module: 3 };

  const out: StudentRow[] = [];
  let ignored = 0;
  for (let i = start + 1; i < rows.length; i++) {
    const cells = (rows[i] ?? []).map((c) => (c ?? "").trim());
    if (!cells.some(Boolean)) continue;
    if (!positional && studentHeader(cells)) continue; // the heading repeated on the next page
    const number = tidyNumber(cells[cols.number] ?? "");
    const full = cols.name != null ? tidyName(cells[cols.name] ?? "")
      : tidyName(`${cells[cols.first!] ?? ""} ${cells[cols.last!] ?? ""}`);
    // Titles, totals and notes have no student number (without headings: one word with a digit).
    if (positional ? !/^[^\s@]{3,32}$/.test(number) || !/\d/.test(number) : !number && !full) { ignored++; continue; }
    const rawEmail = cols.email != null ? (cells[cols.email] ?? "").trim() : "";
    const email = NO_EMAIL.test(rawEmail) ? "" : rawEmail;
    const modCell = cols.module != null ? cells[cols.module] ?? "" : "";
    const mods = modCell ? moduleCodes(modCell) : fallbackModule ? [fallbackModule] : [];
    const base = { student_number: number, full_name: full, ...(email ? { email } : {}), line: i + 1 };
    if (mods.length) for (const module_code of mods) out.push({ ...base, module_code });
    else out.push(base);
  }
  if (!out.length) {
    return { error: positional
      ? "No students found. Put a heading row first, such as: Student number, Full name, Email, Module."
      : "The heading row was found, but there are no students under it." };
  }
  // A "No." column holding 1, 2, 3... is a row count, not student numbers.
  const distinct = [...new Set(out.map((r) => r.student_number))];
  if (cols.weak && distinct.length > 1 && distinct.every((n, i) => n === String(i + 1))) {
    return { error: "The \"No.\" column only counts the rows (1, 2, 3…). Add a column called Student number with each student's number." };
  }
  return { rows: out, ignored };
}

/** The database's reasons, in the words of the person importing. */
export function friendlyImportError(e: string): string {
  const m = /^unknown module code (.+)$/i.exec(e);
  if (m) return `module ${m[1]} doesn't exist yet (create it on the Modules page, or correct the code)`;
  if (/does not match the institution format/.test(e)) return "student number isn't in your institution's format (see Settings)";
  if (/appears more than once/.test(e)) return "the same student number is listed twice with different names or emails";
  return e;
}
