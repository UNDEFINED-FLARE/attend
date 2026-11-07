import { describe, expect, it } from "vitest";
import { csvCell, csvObjects, parseCsv, toCsv } from "@/lib/csv";
import { parseScan } from "@/lib/evidence";

describe("csv", () => {
  it("parses quoted fields, escaped quotes, CRLF and a BOM", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n')).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
  });

  it("normalises headers", () => {
    expect(csvObjects("Student Number,Full Name,Module Code\n21001234, Thabo M ,csc1541")).toEqual([
      { student_number: "21001234", full_name: "Thabo M", module_code: "csc1541" },
    ]);
  });

  it("neutralises spreadsheet formulas on export", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(csvCell("+27 82")).toBe("'+27 82");
    expect(toCsv([{ a: 1, b: null }], ["a", "b"])).toBe("﻿a,b\r\n1,");
  });
});

describe("parseScan", () => {
  it("reads a check-in link", () => {
    expect(parseScan("https://x.app/student/check-in?s=11111111-1111-1111-1111-111111111111&t=123.abc"))
      .toEqual({ session: "11111111-1111-1111-1111-111111111111", token: "123.abc", code: null });
  });
  it("accepts a bare code and rejects junk", () => {
    expect(parseScan(" ab3def ").code).toBe("AB3DEF");
    expect(parseScan("hello world")).toEqual({ session: null, token: null, code: null });
  });
});
