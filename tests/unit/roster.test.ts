import { describe, expect, it } from "vitest";
import { chunkRoster, courseCode, moduleCode, moodlePeople, parseOptions, rosterFromCsv, rosterFromText } from "@/lib/integrations/roster";

const o = parseOptions({});

describe("module codes", () => {
  it("reads the code at the start of a Moodle course name", () => {
    expect(moduleCode("CSC1541_2026_S1")).toBe("CSC1541");
    expect(moduleCode("csc 1541 Group A")).toBe("CSC1541");
    expect(moduleCode("BAD107V-2026")).toBe("BAD107V");
    expect(moduleCode("Staff Induction")).toBe("STAFF INDUCTION");
    expect(moduleCode("CSC1541_2026", false)).toBe("CSC1541_2026");
  });
  it("uses the field the institution chose", () => {
    const c = { id: 5, shortname: "Prog1", fullname: "Programming 1", idnumber: "CSC1541" };
    expect(courseCode(c, o)).toBe("PROG1");
    expect(courseCode(c, parseOptions({ course_code_from: "idnumber" }))).toBe("CSC1541");
  });
});

describe("roster files", () => {
  const csv = `role,number,full_name,email,module_code,module_title
student,22012345,Thabo Nkosi,22012345@Example.ac.za,CSC1541,Programming 1
student,22012345,Thabo Nkosi,22012345@example.ac.za,MAT1541,Calculus
lecturer,E1042,Dr N Mudau,n.mudau@example.ac.za,CSC1541,
,22099999,Lerato M,,csc1541,`;

  it("groups one row per module into one person with all their modules", () => {
    const r = rosterFromCsv(csv);
    expect(r.people).toHaveLength(3);
    expect(r.people[0]).toEqual({ role: "student", number: "22012345", full_name: "Thabo Nkosi", email: "22012345@example.ac.za", module_codes: ["CSC1541", "MAT1541"] });
    expect(r.people[1]).toMatchObject({ role: "lecturer", number: "E1042", module_codes: ["CSC1541"] });
    expect(r.people[2]).toMatchObject({ role: "student", number: "22099999", module_codes: ["CSC1541"] });
    expect(r.modules).toEqual([{ code: "CSC1541", title: "Programming 1" }, { code: "MAT1541", title: "Calculus" }]);
  });

  it("accepts a student system's own column names", () => {
    const r = rosterFromCsv("Student Number,First Name,Surname,Course Code\n22011111,Ama,Dube,PHY1521\n");
    expect(r.people).toEqual([{ role: "student", number: "22011111", full_name: "Ama Dube", module_codes: ["PHY1521"] }]);
    const staff = rosterFromCsv("staff_number,name,email,module\nE7,Prof X,x@u.ac.za,PHY1521\n");
    expect(staff.people[0]).toMatchObject({ role: "lecturer", number: "E7" });
  });

  it("reads the same thing as JSON, ignoring fields it doesn't know", () => {
    const r = rosterFromText(JSON.stringify({ complete: true, modules: [{ code: "CSC1541" }],
      people: [{ role: "Teacher", number: 1042, full_name: "Dr M", email: null, module_codes: ["CSC1541"], password: "x" }] }));
    expect(r.modules).toEqual([{ code: "CSC1541", title: "CSC1541" }]);
    expect(r.people).toEqual([{ role: "lecturer", number: "1042", full_name: "Dr M", module_codes: ["CSC1541"] }]);
  });
});

describe("Moodle participants", () => {
  const users = [
    { id: 1, username: "22012345", fullname: "Thabo Nkosi", email: "T@U.ac.za", idnumber: "", roles: [{ shortname: "student" }] },
    { id: 2, username: "nmudau", fullname: "Dr N Mudau", email: "n@u.ac.za", idnumber: "E1042", roles: [{ shortname: "editingteacher" }] },
    { id: 3, username: "guest", fullname: "Guest", roles: [{ shortname: "guest" }] },
    { id: 4, username: "tutor1", fullname: "Tutor", email: "tut@u.ac.za", idnumber: "22000001", roles: [{ shortname: "student" }, { shortname: "teacher" }] },
  ];
  it("maps students and teachers, and leaves out other roles", () => {
    const p = moodlePeople("CSC1541", users, o);
    expect(p).toHaveLength(3);
    // No ID number in Moodle: the username is the student number.
    expect(p[0]).toEqual({ role: "student", number: "22012345", full_name: "Thabo Nkosi", email: "t@u.ac.za", module_codes: ["CSC1541"] });
    expect(p[1]).toMatchObject({ role: "lecturer", number: "E1042" });
    // Someone who teaches in the course is loaded as teaching it.
    expect(p[2]).toMatchObject({ role: "lecturer", full_name: "Tutor" });
  });
  it("can take the student number from the email", () => {
    const p = moodlePeople("X", [{ id: 9, username: "u9", fullname: "S", email: "22055555@u.ac.za", roles: [{ shortname: "student" }] }], parseOptions({ student_number_from: "email" }));
    expect(p[0].number).toBe("22055555");
  });
});

describe("options and chunks", () => {
  it("falls back to safe defaults for anything unexpected", () => {
    expect(parseOptions({ drop_missing: "yes", nonsense: 1 })).toMatchObject({ create_modules: false, drop_missing: false, student_number_from: "idnumber" });
    expect(parseOptions(null).trim_course_code).toBe(true);
  });
  it("splits large rosters, keeping modules with the first piece", () => {
    const people = Array.from({ length: 5 }, (_, i) => ({ role: "student" as const, number: String(i), full_name: "x", module_codes: [] }));
    const parts = chunkRoster({ modules: [{ code: "A1", title: "A" }], people }, 2);
    expect(parts.map((p) => [p.modules.length, p.people.length])).toEqual([[1, 2], [0, 2], [0, 1]]);
  });
});
