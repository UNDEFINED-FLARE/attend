import { describe, expect, it } from "vitest";
import { findLecturerByName, looksLikeName, matchAssignments, nameScore } from "@/lib/assignment-match";

const modules = [
  { id: "m1", code: "CSC101", title: "Intro to CS" },
  { id: "m2", code: "MAT201", title: "Linear Algebra" },
  { id: "m3", code: "BAD107V", title: "Business Admin" },
];
const lecturers = [
  { id: "l1", full_name: "Dr Nkosinathi Sipho Mello", staff_number: "S1001", email: "mello@uni.ac.za" },
  { id: "l2", full_name: "Prof Thandi Zhanje", staff_number: "S1002", email: null },
  { id: "l3", full_name: "Mr Peter Zhanje", staff_number: "S1003", email: null },
];

describe("name matching", () => {
  it("matches timetable-style surnames with initials", () => {
    expect(nameScore("MELLO NS", "Dr Nkosinathi Sipho Mello")).toBeGreaterThan(0);
    expect(nameScore("Dr N.S. Mello", "Dr Nkosinathi Sipho Mello")).toBeGreaterThan(0);
    expect(nameScore("Mello", "Dr Nkosinathi Sipho Mello")).toBeGreaterThan(0);
  });
  it("rejects initials that don't fit", () => {
    expect(nameScore("MELLO KP", "Dr Nkosinathi Sipho Mello")).toBe(0);
    expect(nameScore("Smith", "Dr Nkosinathi Sipho Mello")).toBe(0);
  });
  it("recognises names, not module titles", () => {
    expect(looksLikeName("Dr Jane Mokoena")).toBe(true);
    expect(looksLikeName("Introduction to Programming")).toBe(false);
    expect(looksLikeName("Room 12")).toBe(false);
  });
});

describe("assignments from documents", () => {
  it("reads a spreadsheet with a header row", () => {
    const rows = [
      ["Module code", "Module name", "Lecturer", "Email", "Role"],
      ["CSC101", "Intro", "N.S. Mello", "", "Primary"],
      ["MAT201", "Algebra", "Thandi Zhanje", "", "Assistant"],
      ["MAT201", "Algebra", "Jane Mokoena", "jane@uni.ac.za", ""],
      ["XYZ999", "Unknown", "Peter Zhanje", "", ""],
    ];
    const r = matchAssignments(rows, modules, lecturers, [{ module_id: "m1", lecturer_id: "l1" }]);
    const by = (code: string, who: string) => r.find((x) => x.code === code && (x.lecturer_name ?? "").includes(who));
    expect(by("CSC101", "Mello")?.status).toBe("exists");
    expect(by("MAT201", "Thandi")).toMatchObject({ status: "assign", lecturer_id: "l2", role: "assistant" });
    expect(by("MAT201", "Mokoena")).toMatchObject({ status: "new_lecturer", email: "jane@uni.ac.za", lecturer_name: "Jane Mokoena" });
    expect(by("XYZ999", "Peter")).toMatchObject({ status: "new_module", lecturer_id: "l3" });
  });

  it("flags a surname shared by two lecturers as ambiguous", () => {
    const r = matchAssignments([["Code", "Lecturer"], ["MAT201", "Zhanje"]], modules, lecturers, []);
    expect(r[0].status).toBe("ambiguous");
  });

  it("reads free-text lines (PDF/Word) and carries the module to the next line", () => {
    const rows = [["MAT201 Linear Algebra"], ["Lecturer: Prof T Zhanje"], ["Contact mello@uni.ac.za for CSC101"]];
    const r = matchAssignments(rows, modules, lecturers, []);
    expect(r.find((x) => x.code === "MAT201")).toMatchObject({ status: "assign", lecturer_id: "l2" });
    expect(r.find((x) => x.code === "CSC101")).toMatchObject({ status: "assign", lecturer_id: "l1" });
  });

  it("uses lecturer pairs from a timetable PDF", () => {
    const r = matchAssignments([], modules, lecturers, [], [{ code: "BAD107V", lecturer: "MELLO NS" }, { code: "CSC101", lecturer: "SINTHUMULE NP" }]);
    expect(r.find((x) => x.code === "BAD107V")).toMatchObject({ status: "assign", lecturer_id: "l1" });
    expect(r.find((x) => x.code === "CSC101")).toMatchObject({ status: "new_lecturer", lecturer_name: "Sinthumule NP" });
  });

  it("ignores unknown codes in free text", () => {
    expect(matchAssignments([["Room ABC1234 Dr Jane Mokoena"]], modules, lecturers, [])).toEqual([]);
  });

  it("writes titles of new lecturers as Dr/Mr/Ms, not DR/MR/MS", () => {
    const r = matchAssignments([], modules, lecturers, [], [{ code: "CSC101", lecturer: "DR NOMSA DLAMINI" }, { code: "MAT201", lecturer: "MRS K NDLOVU" }]);
    expect(r.find((x) => x.code === "CSC101")?.lecturer_name).toBe("Dr Nomsa Dlamini");
    expect(r.find((x) => x.code === "MAT201")?.lecturer_name).toBe("Mrs K Ndlovu");
  });

  it("keeps the document's module name for a module that will be created", () => {
    const r = matchAssignments([["Module code", "Module name", "Lecturer"], ["STA102", "Introduction to Statistics", "N.S. Mello"]], modules, lecturers, []);
    expect(r[0]).toMatchObject({ status: "new_module", module_title: "Introduction to Statistics", lecturer_id: "l1" });
  });

  it("finds modules typed with a space", () => {
    const r = matchAssignments([["Code", "Lecturer"], ["CSC101", "N.S. Mello"]], [{ id: "m9", code: "CSC 101", title: "Intro" }], lecturers, []);
    expect(r[0]).toMatchObject({ status: "assign", module_id: "m9" });
  });
});

describe("finding a lecturer by a timetable name", () => {
  it("matches without the title, by surname and initials, and exactly", () => {
    expect(findLecturerByName("THANDI ZHANJE", lecturers)).toMatchObject({ id: "l2" });
    expect(findLecturerByName("MELLO NS", lecturers)).toMatchObject({ id: "l1" });
    expect(findLecturerByName("mr peter zhanje", lecturers)).toMatchObject({ id: "l3" });
  });
  it("says so when a surname fits two people, and returns nothing for strangers", () => {
    expect(findLecturerByName("ZHANJE", lecturers)).toBe("ambiguous");
    expect(findLecturerByName("NOMSA DLAMINI", lecturers)).toBeNull();
  });
});
