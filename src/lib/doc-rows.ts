import "server-only";
import { extractPdfItems, parseTimetableItems, SCANNED_PDF, type TextItem } from "@/lib/timetable-pdf";
import { openZip } from "@/lib/zip";

// Turns an uploaded document into rows of cells, whatever its format:
// CSV/TSV/text, Excel (.xlsx), Word (.docx, tables and paragraphs) or PDF.

export type DocRows = { rows: string[][]; kind: "csv" | "xlsx" | "docx" | "pdf"; pairs?: { code: string; lecturer: string }[] };

const xmlText = (s: string) => s
  .replace(/<[^>]+>/g, "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&amp;/g, "&");

export function csvRows(text: string): string[][] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  // Judge the separator on several lines: a file may start with a title that has none.
  const sample = lines.slice(0, 10).join("\n");
  const delim = [",", ";", "\t", "|"].sort((a, b) => sample.split(b).length - sample.split(a).length)[0];
  return lines.map((line) => {
    const cells: string[] = [];
    let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true;
      else if (c === delim) { cells.push(cur.trim()); cur = ""; }
      else cur += c;
    }
    cells.push(cur.trim());
    return cells;
  });
}

function xlsxRows(buf: Uint8Array): string[][] {
  const zip = openZip(buf);
  const shared = [...(zip.read("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    xmlText([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
  const sheets = zip.names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => +a.match(/(\d+)\.xml$/)![1] - +b.match(/(\d+)\.xml$/)![1]);
  const rows: string[][] = [];
  for (const sheet of sheets) {
    for (const r of (zip.read(sheet) ?? "").matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1], body = c[2] ?? "";
        const col = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
        const idx = col ? [...col].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1 : cells.length;
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        const type = /t="(\w+)"/.exec(attrs)?.[1];
        const text = type === "s" ? shared[+(v ?? -1)] ?? ""
          : type === "inlineStr" ? xmlText(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "") : xmlText(v ?? "");
        while (cells.length < idx) cells.push("");
        cells[idx] = text.trim();
      }
      if (cells.some(Boolean)) rows.push(cells);
    }
  }
  return rows;
}

function docxRows(buf: Uint8Array): string[][] {
  const doc = openZip(buf).read("word/document.xml");
  if (!doc) throw new Error("not a Word document");
  const rows: string[][] = [];
  const body = doc.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, (tbl) => {
    for (const tr of tbl.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)) {
      const cells = [...tr[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((tc) =>
        [...tc[0].matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((p) => para(p[0])).filter(Boolean).join(" ").trim());
      if (cells.some(Boolean)) rows.push(cells);
    }
    return "";
  });
  for (const p of body.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) {
    const t = para(p[0]);
    if (t) rows.push(t.split(/\t+/).map((x) => x.trim()));
  }
  return rows;
}
const para = (p: string) => xmlText(p.replace(/<w:tab\/>/g, "\t").replace(/<w:br\/>/g, " ")).replace(/[  ]+/g, " ").trim();

/** PDF text grouped into lines; a wide gap between pieces starts a new cell. */
export function pdfRows(items: TextItem[]): string[][] {
  const rows: string[][] = [];
  const byPage = new Map<number, TextItem[]>();
  for (const i of items) byPage.set(i.page, [...(byPage.get(i.page) ?? []), i]);
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const its = byPage.get(page)!.sort((a, b) => b.y - a.y || a.x - b.x);
    let line: TextItem[] = [];
    const flush = () => {
      if (!line.length) return;
      line.sort((a, b) => a.x - b.x);
      const cells: string[] = [];
      let cur = line[0].s, end = line[0].x + line[0].s.length * line[0].h * 0.5;
      for (const it of line.slice(1)) {
        if (it.x - end > Math.max(12, it.h * 1.5)) { cells.push(cur.trim()); cur = it.s; } else cur += (cur.endsWith(" ") || it.s.startsWith(" ") ? "" : " ") + it.s;
        end = it.x + it.s.length * it.h * 0.5;
      }
      cells.push(cur.trim());
      rows.push(cells.filter(Boolean));
      line = [];
    };
    for (const it of its) {
      if (line.length && Math.abs(line[0].y - it.y) > Math.max(2, it.h * 0.4)) flush();
      line.push(it);
    }
    flush();
  }
  return rows;
}

export async function documentRows(name: string, bytes: Uint8Array): Promise<DocRows> {
  const lower = name.toLowerCase();
  const head = String.fromCharCode(...bytes.slice(0, 5));
  if (head === "%PDF-") {
    const items = await extractPdfItems(bytes);
    if (!items.length) throw new Error(SCANNED_PDF);
    // A timetable PDF already pairs each module with its lecturer.
    const tt = parseTimetableItems(items);
    const pairs = tt.classes.filter((c) => c.lecturer).map((c) => ({ code: c.code, lecturer: c.lecturer! }));
    return { rows: pdfRows(items), kind: "pdf", pairs: pairs.length ? pairs : undefined };
  }
  if (head.startsWith("PK")) {
    if (lower.endsWith(".docx")) return { rows: docxRows(bytes), kind: "docx" };
    if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) return { rows: xlsxRows(bytes), kind: "xlsx" };
    // Unknown extension: try both.
    try { return { rows: xlsxRows(bytes), kind: "xlsx" }; } catch { return { rows: docxRows(bytes), kind: "docx" }; }
  }
  if (/\.(xls|doc)$/.test(lower)) throw new Error("Old .xls/.doc files aren't supported. Save it as .xlsx, .docx, CSV or PDF.");
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (/[\u0000-\u0008]/.test(text.slice(0, 2000))) throw new Error("That file type isn't supported. Use PDF, Word (.docx), Excel (.xlsx) or CSV.");
  return { rows: csvRows(text), kind: "csv" };
}
