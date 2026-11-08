"use client";
import type * as Leaflet from "leaflet";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { Button, Field, Input, Notice } from "@/components/ui";
import { campusesFor, coveringRadius, distanceM, loadBuildings, type Building, type Campus, type LatLng } from "@/lib/campuses";
import { collectGps } from "@/lib/evidence";
import { BRAND, drawVenue, INFO, OK, useLeaflet, type Venueish } from "./use-leaflet";

type Tool = "building" | "outline" | "centre";
type Draft = { id?: string; source?: Tool | "existing"; name: string; code: string; capacity: string; lat: number | null; lng: number | null; radius: number; polygon: LatLng[] };
type State = { error?: string; ok?: string } | undefined;
type Venue = Venueish & { id: string; code: string | null; capacity: number | null };

const EMPTY: Draft = { name: "", code: "", capacity: "", lat: null, lng: null, radius: 40, polygon: [] };

const TOOLS: [Tool, string, string][] = [
  ["building", "Pick a building", "Click a building on the map. Its outline becomes the venue boundary."],
  ["outline", "Draw outline", "Click the corners of the hall in order. Three or more points."],
  ["centre", "Centre + radius", "Click the middle of the hall, then set the radius."],
];

export function VenueEditor({ venues, institutionName, save, remove, bulk }: {
  venues: Venue[];
  institutionName: string | null;
  save: (s: State, f: FormData) => Promise<State>;
  remove: (s: State, f: FormData) => Promise<State>;
  bulk: (s: State, f: FormData) => Promise<State>;
}) {
  const campuses = useMemo(() => campusesFor(institutionName), [institutionName]);
  const [campus, setCampus] = useState<Campus>(campuses[0]);
  const [tool, setTool] = useState<Tool>("building");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [buildings, setBuildings] = useState<Building[] | null>(null);
  const [gpsMsg, setGpsMsg] = useState<string | null>(null);
  const [saved, runSave] = useActionState(async (s: State, f: FormData) => {
    const r = await save(s, f);
    if (r?.ok) setDraft(EMPTY);
    return r;
  }, undefined);
  const [removed, runRemove] = useActionState(async (s: State, f: FormData) => {
    const r = await remove(s, f);
    if (r?.ok) setDraft(EMPTY);
    return r;
  }, undefined);

  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [bulkResult, runBulk] = useActionState(async (s: State, f: FormData) => {
    const r = await bulk(s, f);
    if (r?.ok) setPicked(new Set());
    return r;
  }, undefined);
  // Named buildings on this campus that are not already a venue.
  const available = useMemo(() => (buildings ?? []).filter((b) => b.name &&
    !venues.some((v) => (v.polygon?.length && distanceM(centroid(v.polygon), b.center) < 4) ||
      v.name.trim().toLowerCase() === b.name!.trim().toLowerCase())), [buildings, venues]);

  const ref = useRef<HTMLDivElement>(null);
  const m = useLeaflet(ref, campus.center, campus.zoom, { scrollWheelZoom: true });
  const toolRef = useRef(tool);
  toolRef.current = tool;

  // Fly to a campus and load its building footprints from OpenStreetMap.
  useEffect(() => {
    m?.map.flyTo(campus.center, campus.zoom, { duration: 0.6 });
    setDraft((d) => (d.id ? d : EMPTY)); // an unsaved venue belongs to the campus it was placed on
    setBuildings(null);
    let alive = true;
    void loadBuildings(campus.bbox).then((b) => alive && setBuildings(b));
    return () => { alive = false; };
  }, [m, campus]);

  // Map clicks: outline vertices or centre, depending on the tool.
  useEffect(() => {
    if (!m) return;
    const onClick = (e: Leaflet.LeafletMouseEvent) => {
      const p: LatLng = [+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)];
      if (toolRef.current === "outline") {
        setDraft((d) => {
          // A building pick or an existing venue's outline is replaced, never extended.
          const polygon = d.source === "outline" ? [...d.polygon, p] : [p];
          const c = centroid(polygon);
          return { ...d, source: "outline", polygon, lat: c[0], lng: c[1], radius: polygon.length >= 3 ? coveringRadius(c, polygon) : d.radius };
        });
      } else if (toolRef.current === "centre") {
        setDraft((d) => ({ ...d, source: "centre", lat: p[0], lng: p[1], polygon: [] }));
      }
    };
    m.map.on("click", onClick);
    return () => { m.map.off("click", onClick); };
  }, [m]);

  // Campus outline, building footprints, existing venues.
  useEffect(() => {
    if (!m) return;
    const { map, L } = m;
    const g = L.layerGroup().addTo(map);
    if (campus.outline) L.polygon(campus.outline, { color: "#ffffff", weight: 2, dashArray: "6 6", fill: false, interactive: false }).addTo(g);
    for (const b of buildings ?? []) {
      const taken = venues.some((v) => v.polygon && v.polygon.length && distanceM(centroid(v.polygon), b.center) < 4);
      const poly = L.polygon(b.polygon, {
        color: taken ? OK : "#facc15", weight: tool === "building" ? 1.5 : 0.75,
        fillOpacity: tool === "building" ? 0.12 : 0.04, interactive: tool === "building",
      }).addTo(g);
      if (tool === "building") {
        poly.bindTooltip(`${b.name ?? "Unnamed building"}${taken ? " (already a venue)" : ""}`, { sticky: true });
        poly.on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          setDraft((d) => ({
            ...d, source: "building", name: b.name || (d.source === "building" ? "" : d.name), polygon: b.polygon,
            lat: +b.center[0].toFixed(6), lng: +b.center[1].toFixed(6), radius: coveringRadius(b.center, b.polygon),
          }));
        });
      }
    }
    for (const v of venues) {
      drawVenue(L, g, v, v.id === draft.id ? INFO : BRAND, {
        onClick: () => setDraft({ id: v.id, source: "existing", name: v.name, code: v.code ?? "", capacity: v.capacity?.toString() ?? "",
          lat: v.lat, lng: v.lng, radius: v.radius_m ?? 40, polygon: v.polygon ?? [] }),
      });
    }
    return () => { g.remove(); };
  }, [m, campus, buildings, venues, tool, draft.id]);

  // The venue being edited.
  useEffect(() => {
    if (!m) return;
    const { map, L } = m;
    const g = L.layerGroup().addTo(map);
    if (draft.polygon.length >= 2) {
      (draft.polygon.length >= 3 ? L.polygon(draft.polygon, { color: INFO, weight: 3, fillOpacity: 0.25 }) : L.polyline(draft.polygon, { color: INFO, weight: 3 })).addTo(g);
      draft.polygon.forEach((p) => L.circleMarker(p, { radius: 4, color: INFO, fillColor: "#fff", fillOpacity: 1, weight: 2 }).addTo(g));
    } else if (draft.polygon.length === 1) {
      L.circleMarker(draft.polygon[0], { radius: 5, color: INFO }).addTo(g);
    }
    if (draft.lat != null && draft.lng != null && draft.polygon.length < 3) {
      L.circle([draft.lat, draft.lng], { radius: draft.radius, color: INFO, weight: 3, fillOpacity: 0.2 }).addTo(g);
      L.circleMarker([draft.lat, draft.lng], { radius: 4, color: INFO, fillColor: "#fff", fillOpacity: 1 }).addTo(g);
    }
    return () => { g.remove(); };
  }, [m, draft]);

  async function useMyLocation() {
    setGpsMsg("Reading your location… stand in the middle of the hall.");
    const s = await collectGps(12000, 8);
    if (!s) { setGpsMsg("Location unavailable. Allow location access, or click the map instead."); return; }
    const w = s.map((x) => 1 / Math.max(9, x.accuracy ** 2));
    const W = w.reduce((a, b) => a + b, 0);
    const c: LatLng = [+(s.reduce((a, x, i) => a + x.lat * w[i], 0) / W).toFixed(6), +(s.reduce((a, x, i) => a + x.lng * w[i], 0) / W).toFixed(6)];
    const acc = Math.min(...s.map((x) => x.accuracy));
    setDraft((d) => ({ ...d, source: "centre", lat: c[0], lng: c[1], polygon: [], radius: Math.max(d.radius, Math.round(acc + 15)) }));
    setTool("centre");
    m?.map.flyTo(c, 18);
    setGpsMsg(`Centre set from ${s.length} readings (best ±${Math.round(acc)} m). Adjust the radius to cover the hall.`);
  }

  const ready = draft.name.trim().length >= 2 && draft.lat != null && draft.lng != null && (draft.polygon.length === 0 || draft.polygon.length >= 3);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {campuses.map((c) => (
            <button key={c.id} type="button" onClick={() => setCampus(c)}
              className={`rounded-full border px-3 py-1 text-xs ${c.id === campus.id ? "border-brand bg-brand text-brand-ink" : "border-line bg-surface hover:bg-bg"}`}>
              {c.name}
            </button>
          ))}
        </div>
        <div className="relative">
          <div ref={ref} className="z-0 h-[480px] w-full rounded-lg border border-line bg-bg" aria-label="Campus map" />
          <div className="pointer-events-none absolute bottom-3 left-3 z-[400] rounded-md bg-white/90 px-2 py-1 text-xs text-ink shadow">
            {buildings == null ? "Loading campus buildings…" : `${buildings.length} buildings from OpenStreetMap · `}
            <span style={{ color: BRAND }}>■</span> venues <span style={{ color: OK }}>■</span> already used <span className="text-yellow-500">■</span> available
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-bg p-1" role="tablist" aria-label="Placement tool">
          {TOOLS.map(([t, label]) => (
            <button key={t} type="button" role="tab" aria-selected={tool === t} onClick={() => setTool(t)}
              className={`rounded-md px-2 py-1.5 text-xs font-medium ${tool === t ? "bg-surface shadow-sm" : "text-muted"}`}>{label}</button>
          ))}
        </div>
        <p className="text-xs text-muted">{TOOLS.find(([t]) => t === tool)![2]}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" className="h-8 text-xs" onClick={useMyLocation}>Use my location</Button>
          {tool === "outline" && draft.polygon.length > 0 && <>
            <Button type="button" variant="secondary" className="h-8 text-xs" onClick={() => setDraft((d) => ({ ...d, polygon: d.polygon.slice(0, -1) }))}>Undo point</Button>
            <Button type="button" variant="secondary" className="h-8 text-xs" onClick={() => setDraft((d) => ({ ...d, polygon: [] }))}>Clear</Button>
          </>}
          {draft.id && <Button type="button" variant="ghost" className="h-8 text-xs" onClick={() => setDraft(EMPTY)}>New venue</Button>}
        </div>
        {gpsMsg && <p className="text-xs text-info">{gpsMsg}</p>}

        <form action={runSave} className="space-y-3 rounded-lg border border-line p-4">
          <p className="text-sm font-semibold">{draft.id ? "Edit venue" : "New venue"}</p>
          <input type="hidden" name="id" value={draft.id ?? ""} />
          <input type="hidden" name="lat" value={draft.lat ?? ""} />
          <input type="hidden" name="lng" value={draft.lng ?? ""} />
          <input type="hidden" name="polygon" value={draft.polygon.length >= 3 ? JSON.stringify(draft.polygon) : ""} />
          <Field label="Name"><Input name="name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="UIGC Lecture Hall" required /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Code"><Input name="code" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder="UIGC-1" /></Field>
            <Field label="Capacity"><Input name="capacity" type="number" min={1} value={draft.capacity} onChange={(e) => setDraft({ ...draft, capacity: e.target.value })} /></Field>
          </div>
          <Field label={`Radius: ${draft.radius} m`} hint={draft.polygon.length >= 3 ? "Used only as a fallback; the outline is what counts." : "Should just cover the hall plus about 15 m for GPS error."}>
            <input type="range" name="radius_m" min={10} max={Math.max(300, draft.radius)} step={5} value={draft.radius}
              onChange={(e) => setDraft({ ...draft, radius: +e.target.value })} className="w-full accent-[var(--brand)]" />
          </Field>
          <p className="text-xs text-muted">
            {draft.lat == null ? "Not placed on the map yet." : draft.polygon.length >= 3
              ? `Outline with ${draft.polygon.length} corners.` : draft.polygon.length > 0
              ? `${draft.polygon.length} of at least 3 corners.` : `Circle at ${draft.lat.toFixed(5)}, ${draft.lng!.toFixed(5)}.`}
          </p>
          {saved?.error && <Notice tone="bad">{saved.error}</Notice>}
          {saved?.ok && <Notice tone="ok">{saved.ok}</Notice>}
          <Button type="submit" className="w-full" disabled={!ready}>{draft.id ? "Save changes" : "Add venue"}</Button>
        </form>

        {draft.id && (
          <form action={runRemove} onSubmit={(e) => { if (!confirm(`Remove ${draft.name}? Past sessions keep their records.`)) e.preventDefault(); }}>
            <input type="hidden" name="id" value={draft.id} />
            <Button type="submit" variant="ghost" className="w-full text-bad">Remove venue</Button>
            {removed?.error && <Notice tone="bad">{removed.error}</Notice>}
          </form>
        )}

        <details className="rounded-lg border border-line p-4" open={venues.length === 0}>
          <summary className="cursor-pointer text-sm font-semibold">Auto-geofence this campus</summary>
          <p className="mt-2 text-xs text-muted">
            {buildings == null ? "Loading buildings from OpenStreetMap…" : available.length
              ? `${available.length} named buildings here are not venues yet. Tick the lecture venues and create them all at once, outlines included.`
              : "Every named building on this campus is already a venue. Use Draw outline for any others."}
          </p>
          {available.length > 0 && (
            <form action={runBulk} className="mt-3 space-y-2">
              <input type="hidden" name="venues" value={JSON.stringify(available.filter((b) => picked.has(b.id)).map((b) => ({ name: b.name, polygon: b.polygon })))} />
              <label className="flex items-center gap-2 text-xs font-medium">
                <input type="checkbox" className="size-4" checked={picked.size === available.length}
                  onChange={(e) => setPicked(e.target.checked ? new Set(available.map((b) => b.id)) : new Set())} />
                Select all
              </label>
              <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-md bg-bg p-1">
                {available.map((b) => (
                  <label key={b.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface"
                    onMouseEnter={() => m?.map.panTo(b.center)}>
                    <input type="checkbox" className="size-4" checked={picked.has(b.id)}
                      onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(b.id); else n.delete(b.id); return n; })} />
                    <span className="truncate">{b.name}</span>
                  </label>
                ))}
              </div>
              {bulkResult?.error && <Notice tone="bad">{bulkResult.error}</Notice>}
              {bulkResult?.ok && <Notice tone="ok">{bulkResult.ok}</Notice>}
              <Button type="submit" className="w-full" disabled={picked.size === 0}>Create {picked.size || ""} venue{picked.size === 1 ? "" : "s"}</Button>
            </form>
          )}
          {bulkResult?.ok && available.length === 0 && <div className="mt-2"><Notice tone="ok">{bulkResult.ok}</Notice></div>}
        </details>
      </div>
    </div>
  );
}

function centroid(p: LatLng[]): LatLng {
  return [+(p.reduce((a, x) => a + x[0], 0) / p.length).toFixed(6), +(p.reduce((a, x) => a + x[1], 0) / p.length).toFixed(6)];
}
