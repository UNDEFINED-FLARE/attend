import { describe, expect, it } from "vitest";
import type { Building, LatLng } from "@/lib/campuses";
import { circleOutline, distanceToPolygon, planOutlines, type OutlineVenue } from "@/lib/venue-outline";

// A ~40 m square building and a second one ~200 m east.
const sq = (lat: number, lng: number, d = 0.00018): LatLng[] => [[lat - d, lng - d], [lat - d, lng + d], [lat + d, lng + d], [lat + d, lng - d]];
const hall: Building = { id: 1, name: "Hall 1", polygon: sq(-22.976, 30.444), center: [-22.976, 30.444] };
const lib: Building = { id: 2, name: "Library", polygon: sq(-22.976, 30.446), center: [-22.976, 30.446] };
const v = (over: Partial<OutlineVenue>): OutlineVenue => ({ id: "v", name: "Room", building: null, lat: null, lng: null, radius_m: null, polygon: null, ...over });

describe("outlining venues", () => {
  it("measures distance to a polygon's edge, zero inside", () => {
    expect(distanceToPolygon([-22.976, 30.444], hall.polygon)).toBe(0);
    // 0.0004° east of the centre is ~41 m; the wall is ~18.4 m out, so ~22.6 m outside
    const d = distanceToPolygon([-22.976, 30.4444], hall.polygon);
    expect(d).toBeGreaterThan(21);
    expect(d).toBeLessThan(24);
  });

  it("uses the footprint a venue's point is inside, or the nearest one within 25 m", () => {
    const plans = planOutlines([v({ id: "a", lat: -22.976, lng: 30.444 }), v({ id: "b", lat: -22.976, lng: 30.4444 })], [hall, lib], []);
    expect(plans.map((p) => [p.venue.id, p.method, p.source])).toEqual([["a", "inside", "Hall 1"], ["b", "nearest", "Hall 1"]]);
    expect(plans[0].polygon).toEqual(hall.polygon);
  });

  it("draws a circle of the venue's radius when no building is near", () => {
    const [p] = planOutlines([v({ lat: -22.98, lng: 30.45, radius_m: 40 })], [hall], []);
    expect(p.method).toBe("circle");
    expect(p.polygon).toHaveLength(20);
    expect(p.radius_m).toBe(40);
  });

  it("matches unplaced venues by building name, and leaves unknown ones for the admin", () => {
    const places = [{ id: "w2", name: "Main Library", polygon: lib.polygon, center: lib.center }];
    const plans = planOutlines([v({ id: "l", name: "LIB 101", building: "Library" }), v({ id: "x", name: "Zebra Hut 3", building: "Zebra Hut" })], [hall, lib], places);
    expect(plans.find((p) => p.venue.id === "l")).toMatchObject({ method: "named", source: "Main Library" });
    expect(plans.find((p) => p.venue.id === "x")).toMatchObject({ method: "none", polygon: null });
  });

  it("skips venues that already have an outline", () => {
    expect(planOutlines([v({ polygon: hall.polygon, lat: -22.976, lng: 30.444 })], [hall], [])).toEqual([]);
  });

  it("makes circles with the right size", () => {
    const c = circleOutline([-22.976, 30.444], 50);
    const dLat = (c[5][0] - -22.976) * 110_540; // quarter turn: straight north
    expect(Math.round(dLat)).toBe(50);
  });
});
