import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractPdfItems, parseTimetableItems, venueName, type TextItem } from "@/lib/timetable-pdf";

const item = (x: number, y: number, h: number, s: string): TextItem => ({ x, y, h, s, page: 1 });
const HEADER = [
  item(34, 572, 11, "University of Venda - Timetable System"), item(34, 555, 9, "TESTPROG"), item(773, 572, 8, "3 events"),
  item(102, 511, 7, "MONDAY"), item(244, 511, 7, "TUESDAY"), item(386, 511, 7, "WEDNESDAY"),
];

describe("timetable PDF parser", () => {
  it("splits blocks, reads day from the column, and dedupes identical blocks", () => {
    const r = parseTimetableItems([
      ...HEADER,
      item(245.8, 131, 5.5, "ECS1245"), item(245.8, 123, 4.5, "15:00-16:50"), item(245.8, 114, 4.5, "BUILDING : E-BLOCK @ ROOM : E4"), item(245.8, 106, 4.5, "THEMBA MARVIN MAKHUBELE"),
      item(103.5, 389, 5.5, "ECS1245"), item(103.5, 381, 4.5, "10:00-10:50"), item(103.5, 372, 4.5, "ONLINE"), item(103.5, 364, 4.5, "THEMBA MARVIN MAKHUBELE"),
      item(388.1, 441, 5.5, "STA1248"), item(388.1, 433, 4.5, "9:00-10:50"), item(388.1, 424, 4.5, "BUILDING : MAIN AUDITORIUM @ ROOM : AUDITORIUM"),
      item(245.8, 131, 5.5, "ECS1245"), item(245.8, 123, 4.5, "15:00-16:50"), item(245.8, 114, 4.5, "BUILDING : E-BLOCK @ ROOM : E4"),
    ]);
    expect(r.title).toBe("TESTPROG");
    expect(r.expected).toBe(3);
    expect(r.classes).toEqual([
      { code: "ECS1245", weekday: 1, starts_at: "10:00", ends_at: "10:50", online: true, building: null, room: null, venue: null, lecturer: "THEMBA MARVIN MAKHUBELE" },
      { code: "ECS1245", weekday: 2, starts_at: "15:00", ends_at: "16:50", online: false, building: "E-BLOCK", room: "E4", venue: "E-Block E4", lecturer: "THEMBA MARVIN MAKHUBELE" },
      { code: "STA1248", weekday: 3, starts_at: "09:00", ends_at: "10:50", online: false, building: "MAIN AUDITORIUM", room: "AUDITORIUM", venue: "Main Auditorium", lecturer: null },
    ]);
    expect(r.warnings).toEqual([]);
  });

  it("names venues readably", () => {
    expect(venueName("EDUCATION", "LH-01")).toBe("Education LH-01");
    expect(venueName("AGRIC", "LECTURE THEATRE")).toBe("Agric Lecture Theatre");
    expect(venueName("A1-A9", "S-HALL")).toBe("A1-A9 S-Hall");
  });

  it("rejects impossible times instead of guessing", () => {
    const r = parseTimetableItems([...HEADER, item(103.5, 389, 5.5, "ECS1245"), item(103.5, 381, 4.5, "10:00-09:50"), item(103.5, 372, 4.5, "ONLINE")]);
    expect(r.classes).toEqual([]);
    expect(r.warnings[0]).toMatch(/ends before it starts/);
  });

  // The real export is not committed (it names staff); this runs where the file exists.
  const REAL = "C:/Users/kekan/Downloads/Mobile Devices/Timetable_AGBAAE.pdf";
  it.skipIf(!existsSync(REAL))("reads the real UNIVEN export completely", async () => {
    const r = parseTimetableItems(await extractPdfItems(new Uint8Array(readFileSync(REAL))));
    expect(r.title).toBe("AGBAAE");
    expect(r.expected).toBe(75);
    expect(r.warnings).toEqual([]);
    expect(r.classes.length).toBeGreaterThan(0);
    expect(r.classes.length).toBeLessThanOrEqual(75);
    expect(r.classes).toContainEqual(expect.objectContaining({ code: "CHE1222", weekday: 2, starts_at: "08:00", ends_at: "08:50", venue: "Main Auditorium" }));
    expect(new Set(r.classes.map((c) => c.weekday))).toEqual(new Set([1, 2, 3, 4, 5]));
  }, 60_000);
});
