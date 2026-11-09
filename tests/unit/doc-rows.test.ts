import { deflateRawSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { documentRows, csvRows } = await import("@/lib/doc-rows");

/** A minimal ZIP writer (CRC left as 0: the reader doesn't check it). */
function zip(files: Record<string, string>): Uint8Array {
  const locals: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, "utf8"), data = deflateRawSync(raw), n = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, data); central.push(ch, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}

describe("document rows", () => {
  it("reads CSV with quotes and semicolons", () => {
    expect(csvRows('Code;Lecturer\nCSC101;"Mello, N S"\n')).toEqual([["Code", "Lecturer"], ["CSC101", "Mello, N S"]]);
  });

  it("reads an Excel sheet with shared strings and gaps", async () => {
    const x = zip({
      "xl/sharedStrings.xml": '<sst><si><t>Module code</t></si><si><t>Lecturer</t></si><si><t>CSC101</t></si><si><r><t>Dr </t></r><r><t>Mello</t></r></si></sst>',
      "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2" t="s"><v>3</v></c></row><row r="3"><c r="A3"><v>42</v></c></row></sheetData></worksheet>',
    });
    const r = await documentRows("list.xlsx", x);
    expect(r.kind).toBe("xlsx");
    expect(r.rows).toEqual([["Module code", "", "Lecturer"], ["CSC101", "", "Dr Mello"], ["42"]]);
  });

  it("reads Word tables and paragraphs", async () => {
    const p = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
    const tc = (t: string) => `<w:tc>${p(t)}</w:tc>`;
    const d = zip({ "word/document.xml": `<w:document><w:body>${p("Lecturer allocation 2026")}<w:tbl><w:tr>${tc("Code")}${tc("Lecturer")}</w:tr><w:tr>${tc("MAT201")}${tc("Prof T Zhanje &amp; Mr P Zhanje")}</w:tr></w:tbl>${p("Contact: admin@uni.ac.za")}</w:body></w:document>` });
    const r = await documentRows("alloc.docx", d);
    expect(r.kind).toBe("docx");
    expect(r.rows).toEqual([["Code", "Lecturer"], ["MAT201", "Prof T Zhanje & Mr P Zhanje"], ["Lecturer allocation 2026"], ["Contact: admin@uni.ac.za"]]);
  });

  it("refuses old binary Office files with a helpful message", async () => {
    await expect(documentRows("old.xls", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 1, 2]))).rejects.toThrow(/\.xlsx/);
  });
});
