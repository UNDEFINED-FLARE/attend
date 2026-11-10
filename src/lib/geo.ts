// Small geometry helpers for the live map and walking navigation.
// Points are [lat, lng] in degrees, matching campuses.boundary / venues.polygon.
export type LatLng = [number, number];

const R = 6_371_000; // Earth radius, metres
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Compass bearing from a to b, 0–360° (0 = north). */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function compass(deg: number): string {
  return ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][Math.round(deg / 45) % 8];
}

/**
 * Nearest point on a polyline to p: distance in metres and the index of the
 * segment it lies on. Uses a local flat projection, accurate at campus scale.
 */
export function nearestOnLine(p: LatLng, line: LatLng[]): { distance: number; segment: number } {
  if (line.length === 0) return { distance: Infinity, segment: 0 };
  if (line.length === 1) return { distance: distanceM(p, line[0]), segment: 0 };
  const kx = Math.cos(rad(p[0])) * 111_320; // metres per degree of longitude here
  const ky = 110_574;                         // metres per degree of latitude
  let best = { distance: Infinity, segment: 0 };
  for (let i = 0; i < line.length - 1; i++) {
    const ax = (line[i][1] - p[1]) * kx, ay = (line[i][0] - p[0]) * ky;
    const bx = (line[i + 1][1] - p[1]) * kx, by = (line[i + 1][0] - p[0]) * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best.distance) best = { distance: d, segment: i };
  }
  return best;
}

/** True when p lies inside the ring (ray casting). */
export function insidePolygon(p: LatLng, ring: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i], [yj, xj] = ring[j];
    if ((yi > p[0]) !== (yj > p[0]) && p[1] < ((xj - xi) * (p[0] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const fmtDistance = (m: number) => (m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
export const fmtMinutes = (s: number) => (s < 90 ? "1 min" : `${Math.round(s / 60)} min`);
