import { describe, expect, it } from "vitest";
import { applyTransform, autoMap, datasetDef, DATASETS, mappingProblems, mapRows, tableFromJson, unusedColumns } from "@/lib/integrations/datasets";

const students = datasetDef("students")!;

describe("matching a file's columns to UniAttend's fields", () => {
  it("recognises a student system's own column names", () => {
    const headers = ["STUDENT_NO", "First Name", "Surname", "Email Address", "Reg Status", "Campus"];
    const m = autoMap(headers, students);
    expect(m).toMatchObject({
      student_number: { column: "STUDENT_NO" }, first_name: { column: "First Name" }, last_name: { column: "Surname" },
      email: { column: "Email Address" }, status: { column: "Reg Status" },
    });
    expect(mappingProblems(students, m, headers)).toEqual([]);
    // What nothing uses is reported, not silently dropped.
    expect(unusedColumns(m, headers)).toEqual(["Campus"]);
  });

  it("never uses one column for two fields, and says what is missing", () => {
    const headers = ["number", "name"];
    const lect = datasetDef("lecturers")!;
    const m = autoMap(headers, lect);
    expect(m.staff_number).toEqual({ column: "number" });
    expect(m.full_name).toEqual({ column: "name" });
    expect(mappingProblems(students, {}, headers)).toEqual([
      "Choose the column that holds “Student number”.", "Choose the column for the full name, or both first name and surname.",
    ]);
    expect(mappingProblems(students, { student_number: { column: "gone" }, full_name: { fixed: "x" } }, headers)[0]).toMatch(/isn't in this file/);
  });

  it("every dataset has a required field and unique field keys", () => {
    for (const d of DATASETS) {
      expect(d.fields.some((f) => f.required) || d.key === "assignments").toBe(true);
      expect(new Set(d.fields.map((f) => f.key)).size).toBe(d.fields.length);
    }
    expect(DATASETS).toHaveLength(11);
  });

  it("a timetable event needs its start and end, as date-times or as a date with times", () => {
    const ev = datasetDef("timetable_events")!;
    const base = { external_id: { column: "id" }, module_code: { column: "mod" } };
    expect(mappingProblems(ev, base, ["id", "mod"])).toEqual(["Choose the start and end: full date-times, or a date with a start and end time."]);
    expect(mappingProblems(ev, { ...base, starts_at: { column: "s" }, ends_at: { column: "e" } }, ["id", "mod", "s", "e"])).toEqual([]);
    expect(mappingProblems(ev, { ...base, date: { column: "d" }, start_time: { column: "s" }, end_time: { column: "e" } }, ["id", "mod", "d", "s", "e"])).toEqual([]);
  });
});

describe("turning file rows into engine rows", () => {
  it("applies columns, fixed values and tidy-ups, and skips empty rows", () => {
    const headers = ["no", "who", "mail"];
    const rows = [[" 2601 0001 ", "Thabo Nkosi", "T@U.AC.ZA"], ["", "", ""], ["26010002", "Lerato Dube", ""]];
    const out = mapRows(headers, rows, students, {
      student_number: { column: "no", transform: "nospace" }, full_name: { column: "who" },
      email: { column: "mail", transform: "lower" }, status: { fixed: "registered" },
    });
    expect(out).toEqual([
      { student_number: "26010001", full_name: "Thabo Nkosi", email: "t@u.ac.za", status: "registered" },
      { student_number: "26010002", full_name: "Lerato Dube", status: "registered" },
    ]);
  });

  it("reads day-first and month-first dates, and leaves what it can't read for the engine to reject", () => {
    expect(applyTransform("3/2/2026", "date_dmy")).toBe("2026-02-03");
    expect(applyTransform("3/2/2026", "date_mdy")).toBe("2026-03-02");
    expect(applyTransform("15.07.26", "date_dmy")).toBe("2026-07-15");
    expect(applyTransform("2026-07-15T00:00:00", "date_dmy")).toBe("2026-07-15");
    expect(applyTransform("mid July", "date_dmy")).toBe("mid July");
    expect(applyTransform("st-22 01", "digits")).toBe("2201");
    const periods = datasetDef("academic_periods")!;
    expect(autoMap(["Name", "Start Date", "End Date"], periods).starts_on).toEqual({ column: "Start Date", transform: "date_dmy" });
  });

  it("reads JSON lists, including one wrapped in an object", () => {
    expect(tableFromJson([{ a: 1, b: "x" }, { a: 2, c: null }])).toEqual({ headers: ["a", "b", "c"], rows: [["1", "x", ""], ["2", "", ""]] });
    expect(tableFromJson({ total: 1, data: [{ id: 7 }] })).toEqual({ headers: ["id"], rows: [["7"]] });
    expect(tableFromJson("nonsense")).toEqual({ headers: [], rows: [] });
  });
});
