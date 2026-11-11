"use client";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { Submit } from "@/components/form";
import { useLeaflet } from "@/components/map/use-leaflet";
import { Notice } from "@/components/ui";
import type { Place } from "@/lib/building-match";
import { bboxOf, fallbackCampus, loadBuildings, loadPlaces, type Building, type Campus, type LatLng } from "@/lib/campuses";
import { planOutlines, type OutlineMethod, type OutlineVenue } from "@/lib/venue-outline";
import { mapVenuesBulk } from "./map-actions";

type S = { error?: string; ok?: string } | undefined;

const METHOD: Record<OutlineMethod, { label: string; hint: string; color: string; on: boolean }> = {
  inside: { label: "Building it's in", hint: "The venue's point is inside this building's footprint.", color: "#16a34a", on: true },
  nearest: { label: "Nearest building", hint: "A building footprint within 25 m of the venue's point.", color: "#2f6fed", on: true },
  named: { label: "Matched by name", hint: "The venue's building name matches a building on the campus map.", color: "#7c3aed", on: true },
  circle: { label: "Approximate circle", hint: "No building footprint on the public map here, so a circle around the point.", color: "#d97706", on: true },
  none: { label: "Can't place", hint: "No location and no building with that name on the map: draw these by hand.", color: "#dc2626", on: false },
};

/**
 * Outlines every venue automatically from OpenStreetMap building footprints, with
 * a preview on the map; nothing changes until the admin applies it.
 */
export function OutlineAll({ venues, campuses }: { venues: OutlineVenue[]; campuses: Campus[] }) {
  const [data, setData] = useState<{ buildings: Building[]; places: Place[] } | null>(null);
  const [off, setOff] = useState<Set<OutlineMethod>>(new Set(["none"]));
  const [result, apply] = useActionState(mapVenuesBulk, undefined as S);

  // Areas to search: every campus, or (without campuses) around the venues already placed.
  const areas = useMemo(() => {
    if (campuses.length) return campuses.map((c) => c.bbox);
    const pts = venues.filter((v) => v.lat != null && v.lng != null).map((v) => [v.lat!, v.lng!] as LatLng);
    return pts.length ? [bboxOf(fallbackCampus(pts).center, pts, 0.003)] : [];
  }, [campuses, venues]);

  useEffect(() => {
    let alive = true;
    if (!areas.length) { setData({ buildings: [], places: [] }); return; }
    const pad = 0.002;
    const boxes = areas.map((b) => [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad] as [number, number, number, number]);
    void Promise.all([Promise.all(boxes.map(loadBuildings)), Promise.all(boxes.map(loadPlaces))])
      .then(([b, p]) => alive && setData({ buildings: b.flat(), places: p.flat() }));
    return () => { alive = false; };
  }, [areas]);

  const plans = useMemo(() => (data ? planOutlines(venues, data.buildings, data.places) : []), [data, venues]);
  const counts = plans.reduce<Partial<Record<OutlineMethod, number>>>((c, p) => ({ ...c, [p.method]: (c[p.method] ?? 0) + 1 }), {});
  const chosen = plans.filter((p) => p.polygon && p.center && !off.has(p.method));
  const placements = chosen.map((p) => ({ id: p.venue.id, lat: +p.center![0].toFixed(6), lng: +p.center![1].toFixed(6),
    radius_m: Math.max(5, Math.min(2000, Math.round(p.radius_m))), polygon: p.polygon }));
  const outlined = venues.length - plans.length;

  // Preview map
  const ref = useRef<HTMLDivElement>(null);
  const first = plans.find((p) => p.center)?.center ?? campuses[0]?.center ?? ([-28.5, 24.7] as LatLng);
  const leaflet = useLeaflet(ref, first, 17, { scrollWheelZoom: false });
  useEffect(() => {
    if (!leaflet || !data) return;
    const { L, map } = leaflet;
    const g = L.layerGroup().addTo(map);
    const all: LatLng[] = [];
    for (const p of plans) {
      if (!p.polygon) continue;
      const m = METHOD[p.method], on = !off.has(p.method);
      L.polygon(p.polygon, { color: m.color, weight: on ? 2 : 1, fillOpacity: on ? 0.25 : 0.05, dashArray: p.method === "circle" ? "5 5" : undefined })
        .bindTooltip(`${p.venue.name} · ${m.label}${p.source ? ` (${p.source})` : ""}`).addTo(g);
      all.push(...p.polygon);
    }
    if (all.length) map.fitBounds(L.latLngBounds(all), { padding: [20, 20], maxZoom: 18 });
    return () => { g.remove(); };
  }, [leaflet, data, plans, off]);

  if (plans.length === 0 && data) {
    return <p className="text-sm text-muted">Every venue already has an outline ({outlined}). New venues from a timetable import will appear here.</p>;
  }

  return (
    <form action={apply} className="space-y-4">
      <input type="hidden" name="placements" value={JSON.stringify(placements)} />
      <p className="text-sm text-muted">
        {data == null
          ? "Looking up your campus buildings on OpenStreetMap… this can take up to a minute."
          : `${plans.length} of ${venues.length} venues have no outline yet.`}{" "}
        Outlines make the location check fair: a student anywhere inside the building counts, not just near one point.
      </p>

      {data && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {(Object.keys(METHOD) as OutlineMethod[]).filter((k) => counts[k]).map((k) => {
            const m = METHOD[k], on = !off.has(k);
            return (
              <label key={k} className={`flex cursor-pointer items-start gap-2 rounded-2xl border p-3 text-sm ${on ? "border-line bg-surface" : "border-dashed border-line opacity-60"}`}>
                <input type="checkbox" className="mt-0.5 size-4" disabled={k === "none"} checked={on}
                  onChange={(e) => setOff((s) => { const n = new Set(s); if (e.target.checked) n.delete(k); else n.add(k); return n; })} />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 font-semibold"><i className="size-2.5 rounded-full" style={{ background: m.color }} />{counts[k]} · {m.label}</span>
                  <span className="block text-xs text-muted">{m.hint}</span>
                </span>
              </label>
            );
          })}
        </div>
      )}

      <div ref={ref} className="h-80 w-full overflow-hidden rounded-2xl border border-line" aria-label="Preview of the proposed outlines" />

      {data && (
        <details className="rounded-2xl border border-line">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Venue by venue ({plans.length})</summary>
          <ul className="max-h-72 divide-y divide-line overflow-auto text-sm">
            {plans.map((p) => (
              <li key={p.venue.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <i className="size-2.5 shrink-0 rounded-full" style={{ background: METHOD[p.method].color }} />
                <span className="min-w-28 font-medium">{p.venue.name}</span>
                <span className="flex-1 text-muted">{METHOD[p.method].label}{p.source ? ` · ${p.source}` : ""}{p.confidence === "guess" ? " · best guess, check it" : ""}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {counts.none ? (
        <Notice tone="warn">{counts.none} venue{counts.none > 1 ? "s" : ""} can&apos;t be placed automatically (no location and no building of that name on the public map). Use <b>Draw outline</b> on the map below.</Notice>
      ) : null}
      {result?.error && <Notice tone="bad">{result.error}</Notice>}
      {result?.ok && <Notice tone="ok">{result.ok}</Notice>}
      {placements.length > 0 && <Submit label={`Outline ${placements.length} venue${placements.length > 1 ? "s" : ""}`} pending="Saving outlines…" />}
    </form>
  );
}
