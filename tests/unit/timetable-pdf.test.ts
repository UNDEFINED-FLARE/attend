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

describe("CELCAT timetable PDFs (rotated page, wrapped lines)", () => {
  // Same shape as a real Tshwane University of Technology export: day headers share
  // an x value because the page is rotated, so days run along y.
  const it2 = (x: number, y: number, s: string): TextItem => ({ x, y, h: 10, s, page: 1 });
  const items = [
    it2(41, 157, "DEPARTMENT OF TESTING - 2026 - #ABCD19_Y1_GROUP_A"),
    it2(72, 100, "Monday"), it2(72, 229, "Tuesday"), it2(72, 352, "Wednesday"), it2(72, 487, "Thursday"), it2(72, 610, "Friday"), it2(72, 740, "Saturday"),
    it2(435, 188, "CLASS, 05:15pm-08:"), it2(447, 188, "45pm"), it2(463, 188, "Module: PMP107V"), it2(474, 188, "Staff: MONYAI TT"),
    it2(485, 188, "Rooms: 31-106 - PTA (170"), it2(496, 188, "seats); ONLINE - PTA"),
    it2(92, 708, "TUTORIAL, 08:00am-10:"), it2(103, 708, "30am"), it2(119, 708, "Module: ADM107V"), it2(142, 708, "Room: 31-119 - PTA (170"), it2(153, 708, "seats)"),
    it2(222, 58, "CLASS, 12:00pm-01:"), it2(233, 58, "00pm"), it2(249, 58, "Module: STI107V"), it2(260, 58, "Staff: STEYNBERG L"), it2(272, 58, "Room: ONLINE - PTA"),
    it2(10, 10, "Published 2025/11/26 - CELCAT Timetabling"),
  ];
  it("reads type, 12-hour times, day, room, campus, capacity and lecturer", () => {
    const r = parseTimetableItems(items);
    expect(r.title).toBe("ABCD19_Y1_GROUP_A");
    expect(r.warnings).toEqual([]);
    expect(r.classes.map((c) => [c.code, c.weekday, c.starts_at, c.ends_at, c.kind, c.venue, c.capacity, c.lecturer, c.group, c.online])).toEqual([
      ["STI107V", 1, "12:00", "13:00", "lecture", null, null, "STEYNBERG L", "Online", true],
      ["PMP107V", 2, "17:15", "20:45", "lecture", "31-106 (PTA)", 170, "MONYAI TT", "Also online", false],
      ["ADM107V", 6, "08:00", "10:30", "tutorial", "31-119 (PTA)", 170, null, null, false],
    ]);
  });
});

describe("CELCAT layout, 24-hour times on separate lines", () => {
  it("does not read the M of 'Module' as am/pm", () => {
    const at = (s: string, x: number, y: number) => ({ s, x, y, h: 8, page: 1 });
    const items = [
      { s: "Group timetable - #ADIM19_Y4_GROUP_UA", x: 256, y: 559, h: 12, page: 1 },
      at("CLASS, 17:15-20:15", 42, 508), at("Module: EDY107V", 42, 495), at("Staff: MELLO NS", 42, 486), at("Room: 1-G43", 42, 477),
      at("PRACTICAL, 17:15-20:15", 338, 508), at("Module: IFA107V", 338, 495), at("Staff: SELOWA KT", 338, 486), at("Room: 1-G92E", 338, 477),
      at("Monday", 96, 524), at("Tuesday", 242, 524), at("Wednesday", 383, 524),
      { s: "Published 3/13/2026 - CELCAT Timetabling", x: 250, y: 18, h: 10, page: 1 },
    ];
    const r = parseTimetableItems(items);
    expect(r.title).toBe("ADIM19_Y4_GROUP_UA");
    expect(r.classes.map((c) => [c.code, c.weekday, c.starts_at, c.ends_at, c.room, c.lecturer, c.kind])).toEqual([
      ["EDY107V", 1, "17:15", "20:15", "1-G43", "MELLO NS", "lecture"],
      ["IFA107V", 3, "17:15", "20:15", "1-G92E", "SELOWA KT", "practical"],
    ]);
  });
});
