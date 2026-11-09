"use client";
import type * as Leaflet from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { Input } from "@/components/ui";
import type { CampusInput } from "@/lib/campus-schema";
import { FALLBACK_CENTER, FALLBACK_ZOOM, type LatLng } from "@/lib/campuses";
import { BRAND, INFO, useLeaflet } from "./use-leaflet";

type Hit = { name: string; lat: number; lng: number; osm: string; outline: LatLng[] | null };

/**
 * Edit a list of campuses on a map. The chosen campus is placed by clicking
 * the map, by picking an OpenStreetMap search result (which brings its outline
 * when one is mapped), or by drawing an outline corner by corner.
 * `name` is the hidden form field the JSON is written to.
 */
export function CampusesEditor({ initial, name = "campuses" }: { initial: CampusInput[]; name?: string }) {
  const [list, setList] = useState<CampusInput[]>(initial);
  const [sel, setSel] = useState(0);
  const [drawing, setDrawing] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const first = list.find((c) => c.lat != null && c.lng != null);
  const m = useLeaflet(ref, first ? [first.lat!, first.lng!] : FALLBACK_CENTER, first ? 14 : FALLBACK_ZOOM, { scrollWheelZoom: true });
  const selRef = useRef(sel); selRef.current = sel;
  const drawRef = useRef(drawing); drawRef.current = drawing;
  const current = list[sel];

  const update = (i: number, v: Partial<CampusInput>) => setList((l) => l.map((c, k) => (k === i ? { ...c, ...v } : c)));

  // Clicking the map places the selected campus, or adds an outline corner while drawing.
  useEffect(() => {
    if (!m) return;
    const onClick = (e: Leaflet.LeafletMouseEvent) => {
      const p: LatLng = [+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)];
      const i = selRef.current;
      setList((l) => l.map((c, k) => {
        if (k !== i) return c;
        if (drawRef.current) {
          const outline = [...(c.outline ?? []), p];
          const center: LatLng = [+(outline.reduce((a, x) => a + x[0], 0) / outline.length).toFixed(6), +(outline.reduce((a, x) => a + x[1], 0) / outline.length).toFixed(6)];
          return { ...c, outline, lat: center[0], lng: center[1], osm: null };
        }
        return { ...c, lat: p[0], lng: p[1], osm: null };
      }));
    };
    m.map.on("click", onClick);
    return () => { m.map.off("click", onClick); };
  }, [m]);

  // Draw every campus; the selected one stands out.
  useEffect(() => {
    if (!m) return;
    const { map, L } = m;
    const g = L.layerGroup().addTo(map);
    list.forEach((c, i) => {
      if (c.lat == null || c.lng == null) return;
      const color = i === sel ? INFO : BRAND;
      if (c.outline && c.outline.length >= 2) {
        (c.outline.length >= 3 ? L.polygon(c.outline, { color, weight: i === sel ? 3 : 2, fillOpacity: 0.15 }) : L.polyline(c.outline, { color, weight: 3 })).addTo(g);
      }
      L.circleMarker([c.lat, c.lng], { radius: i === sel ? 8 : 6, color: "#fff", weight: 2, fillColor: color, fillOpacity: 1 })
        .bindTooltip(c.name, { permanent: i === sel, direction: "top" }).on("click", (e) => { L.DomEvent.stopPropagation(e); setSel(i); }).addTo(g);
    });
    return () => { g.remove(); };
  }, [m, list, sel]);

  // Fly to the selected campus when it changes.
  useEffect(() => {
    const c = list[sel];
    if (m && c?.lat != null && c.lng != null) m.map.flyTo([c.lat, c.lng], Math.max(c.zoom ?? 16, 15), { duration: 0.5 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the selection changes
  }, [m, sel]);

  async function search() {
    if (!q.trim()) return;
    setSearching(true); setHits(null);
    try {
      const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q, countrycodes: "za", format: "jsonv2", limit: "6", polygon_geojson: "1", polygon_threshold: "0.0001" })}`;
      const rows = (await (await fetch(url, { headers: { Accept: "application/json" } })).json()) as { display_name: string; lat: string; lon: string; osm_type: string; osm_id: number; geojson?: { type: string; coordinates: number[][][] | number[][][][] } }[];
      setHits(rows.map((r) => {
        const g = r.geojson;
        const ring = g?.type === "Polygon" ? (g.coordinates as number[][][])[0] : g?.type === "MultiPolygon" ? (g.coordinates as number[][][][])[0][0] : null;
        let outline = ring ? ring.map(([x, y]) => [+y.toFixed(6), +x.toFixed(6)] as LatLng) : null;
        if (outline && outline.length > 60) { const k = Math.ceil(outline.length / 60); outline = outline.filter((_, i) => i % k === 0); }
        return { name: r.display_name, lat: +(+r.lat).toFixed(6), lng: +(+r.lon).toFixed(6), osm: `${r.osm_type}/${r.osm_id}`, outline: outline && outline.length >= 3 ? outline : null };
      }));
    } catch { setHits([]); }
    setSearching(false);
  }

  const placed = useMemo(() => list.filter((c) => c.lat != null).length, [list]);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <input type="hidden" name={name} value={JSON.stringify(list.map((c) => ({ ...c, located: c.lat != null && c.lng != null })))} />
      <div className="space-y-2">
        <div className="flex gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a place, e.g. the institution's name and town"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void search(); } }} aria-label="Search the map" />
          <button type="button" onClick={search} className="h-10 shrink-0 rounded-xl border border-line px-3 text-sm hover:bg-bg">{searching ? "…" : "Search"}</button>
        </div>
        {hits && (
          <ul className="max-h-40 overflow-y-auto rounded-xl border border-line text-sm">
            {hits.length === 0 && <li className="px-3 py-2 text-muted">No places found. Try a shorter name, or click the map.</li>}
            {hits.map((h) => (
              <li key={h.osm}>
                <button type="button" disabled={!current} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-bg disabled:opacity-50"
                  onClick={() => { update(sel, { lat: h.lat, lng: h.lng, outline: h.outline, osm: h.osm }); setHits(null); m?.map.flyTo([h.lat, h.lng], 16, { duration: 0.5 }); }}>
                  <Icon name="pin" size={14} className="shrink-0 text-muted" />
                  <span className="truncate">{h.name}</span>
                  {h.outline && <span className="shrink-0 text-xs text-ok">outline</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div ref={ref} className="z-0 h-[420px] w-full rounded-xl border border-line bg-bg" aria-label="Campus map" />
        <p className="text-xs text-muted">
          {current ? (drawing ? <>Drawing an outline for <b>{current.name}</b>: click its corners in order.</> : <>Click the map to place <b>{current.name}</b>, or pick a search result.</>) : "Add a campus first."}
          {" "}{placed} of {list.length} campuses placed.
        </p>
      </div>

      <div className="space-y-2">
        <ul className="max-h-[420px] space-y-1.5 overflow-y-auto">
          {list.map((c, i) => (
            <li key={i}>
              <div onClick={() => setSel(i)} className={`cursor-pointer rounded-xl border p-2 ${i === sel ? "border-info bg-info/5" : "border-line"}`}>
                <div className="flex items-center gap-2">
                  <Input value={c.name} onChange={(e) => update(i, { name: e.target.value })} className="h-8 text-sm" aria-label="Campus name" />
                  <button type="button" aria-label={`Remove ${c.name}`} onClick={(e) => { e.stopPropagation(); setList((l) => l.filter((_, k) => k !== i)); setSel(0); }}
                    className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-bad/10 hover:text-bad"><Icon name="x" size={14} /></button>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <Input value={c.town ?? ""} onChange={(e) => update(i, { town: e.target.value })} placeholder="Town" className="h-7 text-xs" aria-label="Town" />
                  <span className={`shrink-0 text-xs ${c.lat != null ? "text-ok" : "text-warn"}`}>{c.lat != null ? (c.outline ? "outline" : "point") : "not placed"}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="h-9 rounded-xl border border-line px-3 text-sm hover:bg-bg"
            onClick={() => { setList((l) => [...l, { name: `Campus ${l.length + 1}`, town: "", lat: null, lng: null, zoom: 16, outline: null, osm: null }]); setSel(list.length); }}>
            <Icon name="plus" size={14} className="inline" /> Add campus
          </button>
          {current && (
            <>
              <button type="button" onClick={() => setDrawing((d) => !d)}
                className={`h-9 rounded-xl border px-3 text-sm ${drawing ? "border-info bg-info text-white" : "border-line hover:bg-bg"}`}>{drawing ? "Finish outline" : "Draw outline"}</button>
              {current.outline && <button type="button" className="h-9 rounded-xl border border-line px-3 text-sm hover:bg-bg" onClick={() => update(sel, { outline: null })}>Clear outline</button>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
