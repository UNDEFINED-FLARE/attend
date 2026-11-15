import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { openZip } from "@/lib/zip";
import { crc32, sheetName, toXlsx } from "@/lib/xlsx";

describe("the Excel writer", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("writes a workbook our own ZIP reader (and Excel) can open, one sheet per table", () => {
    const book = toXlsx([
      { name: "By module", header: ["Module", "Rate"], rows: [["CSC101", 82.5], ["HIS101", null]] },
      { name: "Students at risk", header: ["Student", "Note"], rows: [["A003", "Tom & Jerry <b>"]] },
    ]);
    const z = openZip(book);
    expect(z.names).toEqual(expect.arrayContaining(["[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml", "xl/styles.xml"]));
    const s1 = z.read("xl/worksheets/sheet1.xml")!;
    expect(s1).toContain('<c r="B2"><v>82.5</v></c>');                       // numbers stay numbers
    expect(s1).toContain('<c r="A1" t="inlineStr" s="1">');                    // bold header
    expect(s1).not.toContain('r="B3"');                                         // empty cells are left out
    expect(z.read("xl/worksheets/sheet2.xml")).toContain("Tom &amp; Jerry &lt;b&gt;");
    expect(z.read("xl/workbook.xml")).toContain('name="Students at risk"');
  });

  it("never writes a formula: text starting with = stays text", () => {
    const z = openZip(toXlsx([{ name: "x", header: ["a"], rows: [["=HYPERLINK(\"http://evil\")"]] }]));
    const s = z.read("xl/worksheets/sheet1.xml")!;
    expect(s).not.toContain("<f>");
    expect(s).toContain('t="inlineStr"');
  });

  it("follows Excel's sheet-name rules", () => {
    const taken = new Set<string>();
    expect(sheetName("Faculty: Science/Eng [2026]", taken)).toBe("Faculty  Science Eng  2026");
    expect(sheetName("A very long sheet name that goes past thirty one", taken)).toHaveLength(31);
    expect(sheetName("Faculty  Science Eng  2026", taken)).toBe("Faculty  Science Eng  2026 2");
  });
});

describe("the Excel writer's title block", () => {
  it("puts the institution and document above a frozen, bold header row", () => {
    const z = openZip(toXlsx([{ name: "By module", title: "University of Venda · Attendance report", subtitle: "2026-10-01 to 2026-10-31",
      header: ["Module", "Rate"], rows: [["CSC101", 82.5]] }]));
    const s = z.read("xl/worksheets/sheet1.xml")!;
    expect(s).toContain('<c r="A1" t="inlineStr" s="2"><is><t xml:space="preserve">University of Venda · Attendance report</t>');
    expect(s).toContain('<c r="A2" t="inlineStr" s="3">');
    expect(s).toContain('<c r="A4" t="inlineStr" s="1">');          // header after a blank row
    expect(s).toContain('<c r="B5"><v>82.5</v></c>');
    expect(s).toContain('ySplit="4"');                                // title and header stay visible while scrolling
  });
});
