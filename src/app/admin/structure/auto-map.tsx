"use client";
import { useActionState, useEffect, useMemo, useState } from "react";
import { Submit } from "@/components/form";
import { Icon } from "@/components/icons";
import { Badge, Notice } from "@/components/ui";
import { guessBuilding, matchBuilding, type Match, type Place } from "@/lib/building-match";
import { coveringRadius, loadPlaces, type Campus, type LatLng } from "@/lib/campuses";
import { mapVenuesBulk } from "./map-actions";

type V = { id: string; name: string; building: string | null; lat: number | null; lng: number | null; polygon: LatLng[] | null };
type S = { error?: string; ok?: string } | undefined;

const TONE: Record<Match["confidence"], string> = { exact: "active", likely: "trialing", guess: "pending" };

/**
 * Places every venue that has no location yet, building by building, on the
 * matching building from OpenStreetMap. The admin sees each proposed match
 * with how sure it is, and only ticked buildings are applied.
 */
export function AutoMap({ venues, campuses }: { venues: V[]; campuses: Campus[] }) {
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [result, apply] = useActionState(mapVenuesBulk, undefined as S);

  useEffect(() => {
    let alive = true;
    if (!campuses.length) { setPlaces([]); return; }
    // every campus of the institution, with a margin that catches buildings on the edge
    const pad = 0.002;
    void Promise.all(campuses.map((c) => loadPlaces([c.bbox[0] - pad, c.bbox[1] - pad, c.bbox[2] + pad, c.bbox[3] + pad])))
      .then((lists) => alive && setPlaces(lists.flat()));
    return () => { alive = false; };
  }, [campuses]);

  const unplaced = venues.filter((v) => v.lat == null && !(v.polygon?.length));
  const groups = useMemo(() => {
    const m = new Map<string, V[]>();
    for (const v of unplaced) {
      const b = (v.building ?? guessBuilding(v.name)).trim().toUpperCase();
      m.set(b, [...(m.get(b) ?? []), v]);
    }
    return [...m].map(([building, rooms]) => ({ building, rooms, match: places ? matchBuilding(building, places) : null }))
      .sort((a, b) => Number(!!b.match) - Number(!!a.match) || a.building.localeCompare(b.building));
  }, [unplaced, places]);

  if (!campuses.length) {
    return <p className="text-sm text-muted">Automatic mapping needs your campus map, which UniAttend sets up when your institution is approved. You can still place venues on the map below.</p>;
  }
  if (unplaced.length === 0) {
    return <p className="text-sm text-muted">Every venue has a location. New venues from a timetable import will appear here to be placed.</p>;
  }

  const chosen = groups.filter((g) => g.match && !skip.has(g.building));
  const placements = chosen.flatMap((g) => {
    const p = g.match!.place;
    const radius = p.polygon ? coveringRadius(p.center, p.polygon) : 45;
    return g.rooms.map((r) => ({ id: r.id, lat: +p.center[0].toFixed(6), lng: +p.center[1].toFixed(6), radius_m: radius, polygon: p.polygon }));
  });
  const unmatched = groups.filter((g) => places && !g.match);

  return (
    <form action={apply} className="space-y-3">
      <input type="hidden" name="placements" value={JSON.stringify(placements)} />
      <p className="text-sm text-muted">
        {unplaced.length} venues have no location yet, so students can&apos;t see them on the map and attendance there can&apos;t use GPS.
        {places == null ? " Looking up campus buildings…" : ` Matched ${groups.filter((g) => g.match).length} of ${groups.length} buildings automatically.`}
      </p>
      {places != null && (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {groups.filter((g) => g.match).map((g) => (
            <li key={g.building} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
              <input type="checkbox" className="size-4" checked={!skip.has(g.building)} aria-label={`Place ${g.building}`}
                onChange={(e) => setSkip((s) => { const n = new Set(s); if (e.target.checked) n.delete(g.building); else n.add(g.building); return n; })} />
              <span className="min-w-28 font-medium">{g.building}</span>
              <Icon name="arrowRight" size={14} className="text-muted" />
              <span className="flex-1">{g.match!.place.name} <span className="text-xs text-muted">({g.match!.place.polygon ? "building outline" : "map point, 45 m radius"})</span></span>
              <Badge status={TONE[g.match!.confidence]}>{g.match!.confidence === "guess" ? "best guess, check it" : g.match!.confidence}</Badge>
              <span className="w-full text-xs text-muted sm:w-auto">{g.rooms.length} room{g.rooms.length > 1 ? "s" : ""}: {g.rooms.map((r) => r.name).slice(0, 4).join(", ")}{g.rooms.length > 4 ? "…" : ""}</span>
            </li>
          ))}
        </ul>
      )}
      {unmatched.length > 0 && (
        <Notice tone="warn">
          Not on the public campus map, so place these by hand with <b>Draw outline</b> or <b>Use my location</b> on the map below:{" "}
          {unmatched.map((g) => `${g.building} (${g.rooms.length})`).join(", ")}.
        </Notice>
      )}
      {result?.error && <Notice tone="bad">{result.error}</Notice>}
      {result?.ok && <Notice tone="ok">{result.ok}</Notice>}
      {placements.length > 0 && <Submit label={`Place ${placements.length} venue${placements.length > 1 ? "s" : ""} on the map`} pending="Placing…" />}
    </form>
  );
}
