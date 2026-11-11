import { describe, expect, it } from "vitest";
import { buildIcs, firstOn, icsText } from "@/lib/ics";

const cls = { id: "t1", weekday: 3, starts_at: "08:00:00", ends_at: "09:30:00", code: "CSC1541", title: "Intro, to; Programming", kind: "lecture", venue: "Hall 1", lecturer: "Dr N S Mello" };

describe("timetable calendar file", () => {
  it("finds the first matching weekday on or after a date", () => {
    // 2026-11-11 is a Wednesday (ISO 3)
    expect(firstOn(3, new Date("2026-11-11T00:00:00Z")).toISOString().slice(0, 10)).toBe("2026-11-11");
    expect(firstOn(1, new Date("2026-11-11T00:00:00Z")).toISOString().slice(0, 10)).toBe("2026-11-16");
    expect(firstOn(7, new Date("2026-11-11T00:00:00Z")).toISOString().slice(0, 10)).toBe("2026-11-15");
  });

  it("escapes commas, semicolons and new lines", () => {
    expect(icsText("a,b;c\nd")).toBe("a\\,b\\;c\\nd");
  });

  it("writes weekly repeating events in South African time with a reminder", () => {
    const ics = buildIcs({ name: "My timetable", classes: [cls], from: new Date("2026-11-11T00:00:00Z"), until: new Date("2026-12-04T00:00:00Z"), now: new Date("2026-11-11T08:00:00Z") });
    expect(ics).toContain("DTSTART;TZID=Africa/Johannesburg:20261111T080000");
    expect(ics).toContain("DTEND;TZID=Africa/Johannesburg:20261111T093000");
    expect(ics).toContain("RRULE:FREQ=WEEKLY;UNTIL=20261204T215959Z");
    expect(ics).toContain("SUMMARY:CSC1541 Lecture");
    expect(ics).toContain("Intro\\, to\\; Programming");
    expect(ics).toContain("TRIGGER:-PT15M");
    expect(ics.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });

  it("leaves out classes whose first date is after the end", () => {
    const ics = buildIcs({ name: "x", classes: [{ ...cls, weekday: 5 }], from: new Date("2026-11-11T00:00:00Z"), until: new Date("2026-11-12T00:00:00Z") });
    expect(ics).not.toContain("BEGIN:VEVENT");
  });
});
