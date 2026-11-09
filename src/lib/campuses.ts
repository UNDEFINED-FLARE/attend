// Campus geometry helpers. Nothing about any institution is hard-coded: each
// institution's campuses (centre, zoom, optional outline) come from its own
// rows in uniattend.campuses, set up by the platform administrator.
// Building footprints and named places are loaded live from OpenStreetMap.

export type LatLng = [number, number];

export type Campus = {
  id: string;
  name: string;
  center: LatLng;
  zoom: number;
  outline?: LatLng[] | null;
  /** south, west, north, east */
  bbox: [number, number, number, number];
};

/** Middle of South Africa, for an institution whose campus map isn't set up yet. */
export const FALLBACK_CENTER: LatLng = [-28.5, 24.7];
export const FALLBACK_ZOOM = 5;

export function bboxOf(center: LatLng, outline?: LatLng[] | null, pad = 0.002): [number, number, number, number] {
  if (outline && outline.length >= 3) {
    const lat = outline.map((p) => p[0]), lng = outline.map((p) => p[1]);
    return [Math.min(...lat) - pad, Math.min(...lng) - pad, Math.max(...lat) + pad, Math.max(...lng) + pad];
  }
  const d = 0.008; // ~900 m around the centre
  return [center[0] - d, center[1] - d, center[0] + d, center[1] + d];
}

/** A campus row from the database, as the map components use it. */
export function toCampus(r: { id: string; name: string; lat: number | null; lng: number | null; zoom?: number | null; outline?: unknown }): Campus | null {
  if (r.lat == null || r.lng == null) return null;
  const outline = Array.isArray(r.outline) && r.outline.length >= 3 ? (r.outline as LatLng[]) : null;
  const center: LatLng = [r.lat, r.lng];
  return { id: r.id, name: r.name, center, zoom: r.zoom ?? 16, outline, bbox: bboxOf(center, outline) };
}

/**
 * The campus to open a map on when an institution has none set up yet: around
 * its already-placed venues, otherwise a view of the whole country.
 */
export function fallbackCampus(points: LatLng[]): Campus {
  if (points.length) {
    const center: LatLng = [points.reduce((a, p) => a + p[0], 0) / points.length, points.reduce((a, p) => a + p[1], 0) / points.length];
    return { id: "fallback-venues", name: "Your venues", center, zoom: 16, outline: null, bbox: bboxOf(center) };
  }
  return { id: "fallback-country", name: "Campus map not set up", center: FALLBACK_CENTER, zoom: FALLBACK_ZOOM, outline: null,
           bbox: [FALLBACK_CENTER[0], FALLBACK_CENTER[1], FALLBACK_CENTER[0], FALLBACK_CENTER[1]] };
}

export type Building = { id: number; name: string | null; polygon: LatLng[]; center: LatLng };

const cache = new Map<string, Promise<Building[]>>();

/** Building footprints in a bounding box, from OpenStreetMap. Never throws. */
export function loadBuildings(bbox: [number, number, number, number]): Promise<Building[]> {
  const key = bbox.join(",");
  if (!cache.has(key)) {
    const q = `[out:json][timeout:25];way["building"](${key});out tags geom;`;
    cache.set(key, fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: new URLSearchParams({ data: q }) })
      .then((r) => (r.ok ? r.json() : { elements: [] }))
      .then((j: { elements: { id: number; tags?: { name?: string }; geometry?: { lat: number; lon: number }[] }[] }) =>
        j.elements.filter((e) => e.geometry && e.geometry.length >= 4).map((e) => {
          const polygon = e.geometry!.map((g) => [+g.lat.toFixed(6), +g.lon.toFixed(6)] as LatLng);
          const ring = polygon.slice(0, -1);
          const center: LatLng = [ring.reduce((a, p) => a + p[0], 0) / ring.length, ring.reduce((a, p) => a + p[1], 0) / ring.length];
          return { id: e.id, name: e.tags?.name ?? null, polygon: ring, center };
        }))
      .catch(() => { cache.delete(key); return []; }));
  }
  return cache.get(key)!;
}

/** Metres between two points (haversine). */
export function distanceM(a: LatLng, b: LatLng): number {
  const R = 6371008.8, r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Ray-casting point-in-polygon, for display only (the server makes the real decision). */
export function insidePolygon(p: LatLng, poly: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    if ((yi > p[0]) !== (yj > p[0]) && p[1] < ((xj - xi) * (p[0] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Smallest radius from the centre that covers the outline, plus a margin for GPS error. */
export function coveringRadius(center: LatLng, polygon: LatLng[], margin = 15): number {
  // capped at the database's 2 km limit; for an outline the radius is only a fallback
  return Math.min(2000, Math.round(Math.max(...polygon.map((p) => distanceM(center, p))) + margin));
}

const placeCache = new Map<string, Promise<import("@/lib/building-match").Place[]>>();
const SKIP_PLACE = /^(highway|landuse|boundary|admin_level|barrier|leisure|natural|waterway|route|place)$/;

/** Every named building and point of interest in a bounding box, from OpenStreetMap. Never throws. */
export function loadPlaces(bbox: [number, number, number, number]): Promise<import("@/lib/building-match").Place[]> {
  const key = bbox.join(",");
  if (!placeCache.has(key)) {
    const q = `[out:json][timeout:25];(way["name"](${key});node["name"](${key}););out tags geom;`;
    placeCache.set(key, fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: new URLSearchParams({ data: q }) })
      .then((r) => (r.ok ? r.json() : { elements: [] }))
      .then((j: { elements: { type: string; id: number; lat?: number; lon?: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] }[] }) =>
        j.elements.flatMap((e): import("@/lib/building-match").Place[] => {
          const t = e.tags ?? {};
          if (!t.name || Object.keys(t).some((k) => SKIP_PLACE.test(k))) return [];
          if (e.type === "node" && e.lat != null && e.lon != null) {
            return [{ id: `n${e.id}`, name: t.name, polygon: null, center: [e.lat, e.lon] as LatLng }];
          }
          if (e.type === "way" && e.geometry && e.geometry.length >= 4 && t.building) {
            const ring = e.geometry.slice(0, -1).map((g) => [+g.lat.toFixed(6), +g.lon.toFixed(6)] as LatLng);
            const center: LatLng = [ring.reduce((a, p) => a + p[0], 0) / ring.length, ring.reduce((a, p) => a + p[1], 0) / ring.length];
            return [{ id: `w${e.id}`, name: t.name, polygon: ring, center }];
          }
          return [];
        }))
      .catch(() => { placeCache.delete(key); return []; }));
  }
  return placeCache.get(key)!;
}
