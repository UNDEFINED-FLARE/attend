import { describe, expect, it } from "vitest";
import { bearingDeg, compass, distanceM, fmtDistance, insidePolygon, nearestOnLine, type LatLng } from "@/lib/geo";

const HALL: LatLng = [-22.9761, 30.4445];

describe("geo helpers", () => {
  it("measures distance (0.01° latitude ≈ 1.11 km)", () => {
    expect(distanceM(HALL, [HALL[0] + 0.01, HALL[1]])).toBeGreaterThan(1100);
    expect(distanceM(HALL, [HALL[0] + 0.01, HALL[1]])).toBeLessThan(1120);
    expect(distanceM(HALL, HALL)).toBe(0);
  });

  it("gives compass directions", () => {
    expect(compass(bearingDeg(HALL, [HALL[0] + 0.01, HALL[1]]))).toBe("north");
    expect(compass(bearingDeg(HALL, [HALL[0], HALL[1] + 0.01]))).toBe("east");
    expect(compass(bearingDeg(HALL, [HALL[0] - 0.01, HALL[1] - 0.01]))).toBe("south-west");
  });

  it("finds how far a walker is from the route", () => {
    const route: LatLng[] = [HALL, [HALL[0] + 0.002, HALL[1]], [HALL[0] + 0.002, HALL[1] + 0.002]];
    const onIt = nearestOnLine([HALL[0] + 0.001, HALL[1]], route);
    expect(onIt.distance).toBeLessThan(1);
    expect(onIt.segment).toBe(0);
    const off = nearestOnLine([HALL[0] + 0.001, HALL[1] + 0.0005], route); // ~51 m east of segment 0
    expect(off.distance).toBeGreaterThan(45);
    expect(off.distance).toBeLessThan(60);
    expect(nearestOnLine([HALL[0] + 0.0021, HALL[1] + 0.001], route).segment).toBe(1);
  });

  it("knows inside from outside a campus boundary", () => {
    const d = 0.0018;
    const ring: LatLng[] = [[HALL[0] - d, HALL[1] - d], [HALL[0] - d, HALL[1] + d], [HALL[0] + d, HALL[1] + d], [HALL[0] + d, HALL[1] - d]];
    expect(insidePolygon(HALL, ring)).toBe(true);
    expect(insidePolygon([HALL[0] + 0.01, HALL[1]], ring)).toBe(false);
  });

  it("formats distances for people", () => {
    expect(fmtDistance(42)).toBe("40 m");
    expect(fmtDistance(1530)).toBe("1.5 km");
  });
});
