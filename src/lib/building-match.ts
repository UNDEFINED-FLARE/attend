// Matches timetable building names ("E-BLOCK", "NATURAL SCIENCE") to named
// places on the campus map ("E-block", "school of mathematical and natural
// sciencses"). Pure, so it is unit-tested against real names.
import type { LatLng } from "@/lib/campuses";

export type Place = { id: string; name: string; polygon: LatLng[] | null; center: LatLng };
export type Match = { place: Place; confidence: "exact" | "likely" | "guess" };

const STOP = new Set(["building", "bldg", "school", "of", "the", "faculty", "lecture", "lectures", "hall", "halls",
  "theatre", "theater", "main", "room", "rooms", "and", "centre", "center", "venue", "block"]);

/** Lowercased word tokens without filler words. "Block" is kept when it is all there is to tell buildings apart. */
export function tokens(s: string): string[] {
  const raw = s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const kept = raw.filter((t) => !STOP.has(t));
  // "E-BLOCK" -> ["e"] would be too weak on its own, so keep "block" for single-letter names.
  if (kept.length === 1 && kept[0].length === 1 && raw.includes("block")) return [kept[0], "block"];
  return kept;
}

const same = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5));

/** Known UNIVEN timetable building names whose map name is different, confirmed by eye. */
export const ALIASES: Record<string, { name: string; confidence: Match["confidence"] }> = {
  "A1-A9": { name: "A-Block", confidence: "guess" },
};

export function matchBuilding(building: string, places: Place[]): Match | null {
  const alias = ALIASES[building.trim().toUpperCase()];
  if (alias) {
    const p = places.find((x) => x.name.trim().toLowerCase() === alias.name.toLowerCase());
    if (p) return { place: p, confidence: alias.confidence };
  }
  const want = tokens(building);
  if (!want.length) return null;
  let best: { place: Place; score: number; exact: boolean } | null = null;
  for (const p of places) {
    const have = tokens(p.name);
    if (!have.length || !want.every((w) => have.some((h) => same(w, h)))) continue;
    const extra = have.filter((h) => !want.some((w) => same(w, h))).length;
    const exact = extra === 0;
    // fewer unexplained words is better; an outline beats a single point
    const score = 1 - 0.1 * extra + (p.polygon ? 0.05 : 0);
    if (!best || score > best.score) best = { place: p, score, exact };
  }
  if (!best || best.score < 0.7) return null;
  return { place: best.place, confidence: best.exact ? "exact" : "likely" };
}

/** Building part of a venue name created by an import: "E-Block E4" -> "E-Block". */
export function guessBuilding(venueName: string): string {
  const parts = venueName.trim().split(/\s+/);
  return parts.length > 1 && /^[A-Z]{0,4}-?\d+[A-Z]?$/i.test(parts[parts.length - 1]) ? parts.slice(0, -1).join(" ") : venueName;
}
