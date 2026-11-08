// Known campuses for the pilot region. Centres and outlines are from
// OpenStreetMap (© OpenStreetMap contributors, ODbL), fetched 2026-11-08:
//   University of Venda      — way 460936140
//   Vhembe TVET College      — way 1245608817 (Thohoyandou campus)
//   Vhembe TVET Thengwe      — node search result, no outline mapped
// Building footprints inside a campus are loaded live from OpenStreetMap
// (Overpass API) by the venue editor, so new buildings appear without a deploy.

export type LatLng = [number, number];

export type Campus = {
  id: string;
  institution: string;
  name: string;
  center: LatLng;
  zoom: number;
  outline?: LatLng[];
  /** south, west, north, east — used to fetch building footprints */
  bbox: [number, number, number, number];
};

export const CAMPUSES: Campus[] = [
  {
    id: "univen-main",
    institution: "University of Venda",
    name: "UNIVEN main campus, Thohoyandou",
    center: [-22.9768, 30.4427],
    zoom: 16,
    bbox: [-22.9826, 30.4331, -22.9721, 30.4523],
    outline: [[-22.976633,30.433125],[-22.981485,30.435296],[-22.982271,30.437609],[-22.982409,30.439106],[-22.982301,30.442459],[-22.982548,30.444126],[-22.9823,30.445896],[-22.98187,30.446745],[-22.981172,30.450228],[-22.980201,30.450957],[-22.975029,30.452039],[-22.972152,30.452224],[-22.972628,30.451527],[-22.973603,30.448904],[-22.97332,30.448734],[-22.973685,30.447641],[-22.97244,30.44671],[-22.97213,30.446634],[-22.973464,30.441398],[-22.976633,30.433125]],
  },
  {
    id: "vhembe-tvet-thohoyandou",
    institution: "Vhembe TVET College",
    name: "Vhembe TVET, Thohoyandou campus",
    center: [-22.9412, 30.4826],
    zoom: 17,
    bbox: [-22.9439, 30.4798, -22.9387, 30.4855],
    outline: [[-22.942743,30.47987],[-22.943496,30.480564],[-22.942953,30.481015],[-22.943801,30.481693],[-22.941315,30.485428],[-22.93991,30.485111],[-22.938756,30.484749],[-22.939514,30.483174],[-22.942743,30.47987]],
  },
  {
    id: "vhembe-tvet-thengwe",
    institution: "Vhembe TVET College",
    name: "Vhembe TVET, Thengwe campus",
    center: [-22.7515, 30.5124],
    zoom: 17,
    bbox: [-22.7545, 30.5094, -22.7485, 30.5154],
  },
];

/** Campuses to offer first for an institution, matched on its name. */
export function campusesFor(institutionName: string | null | undefined): Campus[] {
  const n = (institutionName ?? "").toLowerCase();
  const own = CAMPUSES.filter((c) =>
    (/venda|univen/.test(n) && c.institution === "University of Venda") ||
    (/vhembe/.test(n) && c.institution === "Vhembe TVET College"));
  return own.length ? [...own, ...CAMPUSES.filter((c) => !own.includes(c))] : CAMPUSES;
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
