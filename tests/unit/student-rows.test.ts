import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { csvRows } from "@/lib/doc-rows";
import { friendlyImportError, studentHeader, studentRows } from "@/lib/student-rows";

// Student lists as administrators actually have them: Excel exports with their own headings,
// semicolon CSVs from South African Excel, class-list PDFs with titles, pasted lists.
const MODULES = ["CSC111", "MAT101", "ENG 101"];
const ok = (r: ReturnType<typeof studentRows>) => {
  if ("error" in r) throw new Error(r.error);
  return r;
};
/** The rows without their source line, for comparing values. */
const strip = <T extends { line: number }>(rows: T[]) => rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "line")));

describe("finding the heading row", () => {
  it("still reads the original CSV headings", () => {
    const r = ok(studentRows([["student_number", "full_name", "email", "module_code"], ["22012345", "Thabo Mulaudzi", "t@uni.ac.za", "CSC111"]]));
    expect(strip(r.rows)).toEqual([{ student_number: "22012345", full_name: "Thabo Mulaudzi", email: "t@uni.ac.za", module_code: "CSC111" }]);
  });

  it("reads everyday headings in any order, below a title, and skips totals", () => {
    const rows = [
      ["UniAttend Test University"], ["Student class list - Semester 1, 2026"],
      ["#", "Email", "Full name", "Student No.", "Module"],
      ["1", "a.zulu@example.com", "Ayanda Zulu", "20261001", "CSC111"],
      ["2", "", "Kagiso  Molefe", "20261002", "MAT101"],
      ["24 students."],
    ];
    const r = ok(studentRows(rows, { modules: MODULES }));
    expect(r.rows).toEqual([
      { student_number: "20261001", full_name: "Ayanda Zulu", email: "a.zulu@example.com", module_code: "CSC111", line: 4 },
      { student_number: "20261002", full_name: "Kagiso Molefe", module_code: "MAT101", line: 5 },
    ]);
    expect(r.ignored).toBe(1);
  });

  it("joins First name and Surname columns", () => {
    const r = ok(studentRows([["Surname", "First names", "Student number"], ["Zulu", "Ayanda Grace", "20261001"]]));
    expect(r.rows[0]).toMatchObject({ student_number: "20261001", full_name: "Ayanda Grace Zulu" });
  });

  it("prefers a real student-number column to a row counter and ignores ID numbers", () => {
    expect(studentHeader(["No.", "Name", "ID number", "Student number"])).toMatchObject({ number: 3, name: 1 });
    expect(studentHeader(["Name", "ID number"])).toBeNull();
  });

  it("does not take a degree 'Course' column for module codes", () => {
    const r = ok(studentRows([["Student number", "Name", "Course"], ["20261001", "Ayanda Zulu", "BSc Computer Science"]]));
    expect(r.rows[0].module_code).toBeUndefined();
  });

  it("explains a row counter that isn't a student number", () => {
    const r = studentRows([["No", "Name"], ["1", "Ayanda Zulu"], ["2", "Kagiso Molefe"]]);
    expect(r).toEqual({ error: expect.stringMatching(/only counts the rows/) });
  });

  it("skips the heading repeated at the top of the next page", () => {
    const head = ["Student number", "Full name"];
    const r = ok(studentRows([head, ["20261001", "Ayanda Zulu"], head, ["20261002", "Kagiso Molefe"]]));
    expect(r.rows.map((x) => x.student_number)).toEqual(["20261001", "20261002"]);
  });
});

describe("cleaning the values", () => {
  it("splits several modules and matches codes however they were typed", () => {
    const r = ok(studentRows([["Student number", "Name", "Modules"], ["20261001", "Ayanda Zulu", "csc 111; MAT101, ENG101"]], { modules: MODULES }));
    expect(r.rows.map((x) => x.module_code)).toEqual(["CSC111", "MAT101", "ENG 101"]);
    expect(new Set(r.rows.map((x) => x.line))).toEqual(new Set([2]));
  });

  it("passes an unknown module through as typed, so the error names it", () => {
    const r = ok(studentRows([["Student number", "Name", "Module"], ["20261001", "Ayanda Zulu", "Physics"]], { modules: MODULES }));
    expect(r.rows[0].module_code).toBe("Physics");
  });

  it("treats '-' or 'N/A' as no email and fixes numbers that went through a spreadsheet", () => {
    const r = ok(studentRows([["Student number", "Name", "Email"], ["20261001.0", "Ayanda Zulu", "N/A"], ["20261002", "Kagiso Molefe", "-"]]));
    expect(strip(r.rows)).toEqual([{ student_number: "20261001", full_name: "Ayanda Zulu" }, { student_number: "20261002", full_name: "Kagiso Molefe" }]);
  });

  it("keeps a row with a missing number, so the import can say which row it is", () => {
    const r = ok(studentRows([["Student number", "Name"], ["", "Ayanda Zulu"]]));
    expect(r.rows).toEqual([{ student_number: "", full_name: "Ayanda Zulu", line: 2 }]);
  });
});

describe("files and pasted lists", () => {
  it("reads a semicolon CSV, as South African Excel saves it", () => {
    const r = ok(studentRows(csvRows("Student Number;Name;Email\r\n20261001;Ayanda Zulu;a@x.co.za\r\n"), { modules: MODULES }));
    expect(strip(r.rows)).toEqual([{ student_number: "20261001", full_name: "Ayanda Zulu", email: "a@x.co.za" }]);
  });

  it("finds the separator even when the file starts with a title line", () => {
    const r = ok(studentRows(csvRows("Class list\r\nStudent Number;Name;Modules\r\n20261001;Ayanda Zulu;CSC111, MAT101\r\n"), { modules: MODULES }));
    expect(strip(r.rows)).toEqual([
      { student_number: "20261001", full_name: "Ayanda Zulu", module_code: "CSC111" },
      { student_number: "20261001", full_name: "Ayanda Zulu", module_code: "MAT101" },
    ]);
  });

  it("reads a pasted list without headings in the order the screen describes, with the default module", () => {
    const r = ok(studentRows(csvRows("Students for CSC111, 2026\n20261001, Ayanda Zulu\n20261002, Kagiso Molefe\n"), { modules: MODULES, defaultModule: "csc111", pasted: true }));
    expect(strip(r.rows)).toEqual([
      { student_number: "20261001", full_name: "Ayanda Zulu", module_code: "CSC111" },
      { student_number: "20261002", full_name: "Kagiso Molefe", module_code: "CSC111" },
    ]);
    expect(r.ignored).toBe(1);
  });

  it("refuses an uploaded file that isn't a student list, instead of creating odd students", () => {
    const lecturerList = [["Lecturer allocation - Semester 1, 2026"], ["Module code", "Module name", "Lecturer", "Email"],
      ["CSC111", "Introduction to Programming", "Dr Thandi Mokoena", "thandi.mokoena@example.com"]];
    expect(studentRows(lecturerList)).toEqual({ error: expect.stringMatching(/doesn't look like a student list/) });
  });

  it("reads tab-separated lines pasted from Excel with headings in any order", () => {
    const r = ok(studentRows(csvRows("Name\tStudent number\nAyanda Zulu\t20261001\n")));
    expect(strip(r.rows)).toEqual([{ student_number: "20261001", full_name: "Ayanda Zulu" }]);
  });

  it("says what to do when a pasted list has no students", () => {
    expect(studentRows([["Hello"], ["World"]], { pasted: true })).toEqual({ error: expect.stringMatching(/No students found.*heading row/) });
  });
});

describe("import errors in plain words", () => {
  it("rewrites the database's reasons", () => {
    expect(friendlyImportError("unknown module code XYZ101")).toMatch(/module XYZ101 doesn't exist yet/);
    expect(friendlyImportError("student number does not match the institution format")).toMatch(/format/);
    expect(friendlyImportError("name is missing")).toBe("name is missing");
  });
});
