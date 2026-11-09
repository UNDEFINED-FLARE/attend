import { describe, expect, it } from "vitest";
import { guessBuilding, matchBuilding, type Place } from "@/lib/building-match";

// Real names from OpenStreetMap on the UNIVEN campus (2026-11-09).
const P = (name: string, polygon = false): Place => ({ id: name, name, polygon: polygon ? [[0, 0], [0, 1], [1, 1]] : null, center: [0, 0] });
const places = [
  P("E-block", true), P("E-Block lecture hall"), P("D-Block lecture hall"), P("A-Block", true), P("B- Block lecture halls", true),
  P("Agric Lecture halls"), P("Agric Labs"), P("School of Agriculture"), P("School of Education"), P("auditorium"),
  P("school of mathematical and natural sciencses", true), P("Management Foundation Office"), P("School of Law", true), P("UIGC Lecture halls", true),
];
const m = (b: string) => { const r = matchBuilding(b, places); return r ? `${r.place.name} (${r.confidence})` : null; };

describe("timetable building -> campus map", () => {
  it("matches the buildings that are on the map", () => {
    expect(m("E-BLOCK")).toBe("E-block (exact)");               // outline preferred over the point
    expect(m("D-BLOCK")).toBe("D-Block lecture hall (exact)");
    expect(m("AGRIC")).toBe("Agric Lecture halls (exact)");
    expect(m("EDUCATION")).toBe("School of Education (exact)");
    expect(m("MAIN AUDITORIUM")).toBe("auditorium (exact)");
    expect(m("NATURAL SCIENCE")).toBe("school of mathematical and natural sciencses (likely)");
    expect(m("A1-A9")).toBe("A-Block (guess)");
  });
  it("does not invent matches", () => {
    expect(m("OLD EDUCATION")).toBeNull();
    expect(m("MANAGEMENT SCIENCES")).toBeNull();
    expect(m("HUMANITIES AND SOCIAL SCIENCE")).toBeNull();
    expect(m("MUSIC")).toBeNull();
    expect(m("C-BLOCK")).toBeNull();
  });
  it("reads the building out of an imported venue name", () => {
    expect(guessBuilding("E-Block E4")).toBe("E-Block");
    expect(guessBuilding("Education LH-01")).toBe("Education");
    expect(guessBuilding("Main Auditorium")).toBe("Main Auditorium");
  });
});
