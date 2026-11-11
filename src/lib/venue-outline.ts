// Gives every venue an outline: the OpenStreetMap building it is in, the building
// its name matches, or — when no footprint exists — a circle around its point.
// Pure (no network), so it can be tested; the map data is loaded by the caller.
import { guessBuilding, matchBuilding, type Place } from "@/lib/building-match";
import { coveringRadius, distanceM, insidePolygon, type Building, type LatLng } from "@/lib/campuses";

export type OutlineVenue = { id: string; name: string; building: string | null; lat: number | null; lng: number | null;
  radius_m: number | null; polygon: LatLng[] | null };

export type OutlineMethod =
  | "inside"      // its point is inside a building footprint
  | "nearest"     // a building footprint within NEAR_M of its point
  | "named"       // its building name matches a mapped building with a footprint
  | "circle"      // a point but no footprint nearby: circle of its radius
  | "none";       // no point and no matching building: place by hand

export type OutlinePlan = { venue: OutlineVenue; method: OutlineMethod; polygon: LatLng[] | null; center: LatLng | null;
  radius_m: number; source: string | null; confidence?: "exact" | "likely" | "guess" };

export const NEAR_M = 25;
const DEFAULT_RADIUS = 30;

/** Metres from a point to a polygon's edge (0 when inside). Local flat projection: fine at building scale. */
export function distanceToPolygon(p: LatLng, poly: LatLng[]): number {
  if (insidePolygon(p, poly)) return 0;
  const kx = Math.cos((p[0] * Math.PI) / 180) * 111_320, ky = 110_540;
  const xy = (q: LatLng): [number, number] => [(q[1] - p[1]) * kx, (q[0] - p[0]) * ky];
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = xy(poly[j]), [bx, by] = xy(poly[i]);
    const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/** A 20-sided circle as an outline, for venues with no building footprint. */
export function circleOutline(center: LatLng, radiusM: number, sides = 20): LatLng[] {
  const dLat = radiusM / 110_540, dLng = radiusM / (Math.cos((center[0] * Math.PI) / 180) * 111_320);
  return Array.from({ length: sides }, (_, i) => {
    const a = (2 * Math.PI * i) / sides;
    return [+(center[0] + dLat * Math.sin(a)).toFixed(6), +(center[1] + dLng * Math.cos(a)).toFixed(6)] as LatLng;
  });
}

/** The building a point is in, or the closest one within NEAR_M. */
export function buildingAt(p: LatLng, buildings: Building[]): { building: Building; inside: boolean } | null {
  let best: { building: Building; d: number } | null = null;
  for (const b of buildings) {
    // cheap reject: far from the building's centre
    if (distanceM(p, b.center) > 400) continue;
    const d = distanceToPolygon(p, b.polygon);
    if (d === 0) return { building: b, inside: true };
    if (d <= NEAR_M && (!best || d < best.d)) best = { building: b, d };
  }
  return best ? { building: best.building, inside: false } : null;
}

export function planOutlines(venues: OutlineVenue[], buildings: Building[], places: Place[]): OutlinePlan[] {
  const plans: OutlinePlan[] = [];
  for (const v of venues) {
    if (v.polygon && v.polygon.length >= 3) continue; // already outlined
    const label = (b: Building | null) => b?.name ?? "Unnamed building";

    if (v.lat != null && v.lng != null) {
      const p: LatLng = [v.lat, v.lng];
      const at = buildingAt(p, buildings);
      if (at) {
        plans.push({ venue: v, method: at.inside ? "inside" : "nearest", polygon: at.building.polygon, center: at.building.center,
          radius_m: coveringRadius(at.building.center, at.building.polygon), source: label(at.building) });
      } else {
        const r = v.radius_m ?? DEFAULT_RADIUS;
        plans.push({ venue: v, method: "circle", polygon: circleOutline(p, r), center: p, radius_m: r, source: null });
      }
      continue;
    }

    const m = matchBuilding((v.building ?? guessBuilding(v.name)).trim(), places);
    if (!m) { plans.push({ venue: v, method: "none", polygon: null, center: null, radius_m: DEFAULT_RADIUS, source: null }); continue; }
    const place = m.place;
    const footprint = place.polygon ?? buildingAt(place.center, buildings)?.building.polygon ?? null;
    if (footprint) {
      const center = place.polygon ? place.center : buildingAt(place.center, buildings)!.building.center;
      plans.push({ venue: v, method: "named", polygon: footprint, center, radius_m: coveringRadius(center, footprint), source: place.name, confidence: m.confidence });
    } else {
      plans.push({ venue: v, method: "circle", polygon: circleOutline(place.center, 45), center: place.center, radius_m: 45, source: place.name, confidence: m.confidence });
    }
  }
  return plans;
}
