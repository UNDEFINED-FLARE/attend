"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { isRing, useLeafletMap, type Ring } from "@/components/map/use-leaflet";
import { Badge, Button, Card, CardTitle, Input, Notice, Select } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { addCampus, saveCampusBoundary } from "../actions";

export type Campus = { id: string; name: string; lat: number | null; lng: number | null; boundary: unknown };
export type Venue = { id: string; name: string; code: string | null; lat: number; lng: number };
type Live = {
  user_id: string; full_name: string | null; student_number: string | null; lat: number; lng: number;
  accuracy_m: number; on_campus: boolean; campus_name: string | null; mode: "campus" | "safety"; updated_at: string;
};

const POLL_MS = 15_000;
const UNIVEN: [number, number] = [-22.9761, 30.4445];
const COLOR = { campus: "#16a34a", safety: "#ea580c", stale: "#94a3b8" };

const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};

export function LiveMap({ institutionId, intervalS, campuses, venues }: {
  institutionId: string; intervalS: number; campuses: Campus[]; venues: Venue[];
}) {
  const router = useRouter();
  const start = useMemo<[number, number]>(() => {
    const c = campuses.find((x) => x.lat != null && x.lng != null);
    return c ? [c.lat as number, c.lng as number] : venues[0] ? [venues[0].lat, venues[0].lng] : UNIVEN;
  }, [campuses, venues]);
  const { ref, L, map } = useLeafletMap(start, 16);

  const [rows, setRows] = useState<Live[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // campus id
  const [points, setPoints] = useState<Ring>([]);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [newCampus, setNewCampus] = useState("");
  const people = useRef<Leaflet.LayerGroup | null>(null);
  const draft = useRef<Leaflet.LayerGroup | null>(null);

  // Static layers: campus outlines and venues.
  useEffect(() => {
    if (!L || !map) return;
    const g = L.layerGroup().addTo(map);
    const bounds: [number, number][] = [];
    for (const c of campuses) {
      if (isRing(c.boundary)) {
        L.polygon(c.boundary, { color: "#2563eb", weight: 2, fillOpacity: 0.05 }).bindTooltip(c.name).addTo(g);
        bounds.push(...c.boundary);
      }
    }
    for (const v of venues) {
      L.circleMarker([v.lat, v.lng], { radius: 4, color: "#475569", weight: 1, fillOpacity: 0.6 })
        .bindTooltip(v.code ? `${v.name} (${v.code})` : v.name).addTo(g);
      bounds.push([v.lat, v.lng]);
    }
    if (bounds.length > 1) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 17 });
    return () => { g.remove(); };
  }, [L, map, campuses, venues]);

  // Poll live positions. RLS makes sure an admin only ever gets their own institution.
  useEffect(() => {
    let stop = false;
    const load = async () => {
      const { data, error } = await supabaseBrowser().rpc("campus_live_locations", { p_inst: institutionId });
      if (stop) return;
      if (error) setLoadError(error.message);
      else { setLoadError(null); setRows((data ?? []) as Live[]); }
    };
    void load();
    const t = setInterval(load, POLL_MS);
    return () => { stop = true; clearInterval(t); };
  }, [institutionId]);

  // Draw people. A position older than 3 update intervals is shown grey ("stale").
  useEffect(() => {
    if (!L || !map) return;
    people.current?.remove();
    const g = L.layerGroup().addTo(map);
    people.current = g;
    for (const r of rows) {
      const stale = Date.now() - new Date(r.updated_at).getTime() > intervalS * 3000;
      const color = stale ? COLOR.stale : COLOR[r.mode];
      L.circle([r.lat, r.lng], { radius: Math.min(r.accuracy_m, 200), color, weight: 0, fillOpacity: 0.12 }).addTo(g);
      L.circleMarker([r.lat, r.lng], { radius: 7, color: "#fff", weight: 2, fillColor: color, fillOpacity: 1 })
        .bindTooltip(`${r.full_name ?? "Student"}${r.student_number ? ` · ${r.student_number}` : ""}<br>${r.mode === "safety" ? "Safety sharing (off campus)" : r.campus_name ?? "On campus"} · ${ago(r.updated_at)}`)
        .addTo(g);
    }
  }, [L, map, rows, intervalS]);

  // Boundary drawing: each map click adds a corner.
  useEffect(() => {
    if (!L || !map || !editing) return;
    const onClick = (e: Leaflet.LeafletMouseEvent) => setPoints((p) => [...p, [e.latlng.lat, e.latlng.lng]]);
    map.on("click", onClick);
    map.getContainer().style.cursor = "crosshair";
    return () => { map.off("click", onClick); map.getContainer().style.cursor = ""; };
  }, [L, map, editing]);

  useEffect(() => {
    if (!L || !map) return;
    draft.current?.remove();
    const g = L.layerGroup().addTo(map);
    draft.current = g;
    if (points.length >= 2) L.polyline([...points, ...(points.length >= 3 ? [points[0]] : [])], { color: "#dc2626", dashArray: "6 4" }).addTo(g);
    points.forEach((p) => L.circleMarker(p, { radius: 4, color: "#dc2626", fillOpacity: 1 }).addTo(g));
  }, [L, map, points]);

  function startEdit(id: string) {
    const c = campuses.find((x) => x.id === id);
    setPoints(isRing(c?.boundary) ? c.boundary : []);
    setEditing(id);
    setMsg(null);
  }

  async function saveBoundary() {
    if (!editing) return;
    const fd = new FormData();
    fd.set("campus_id", editing);
    fd.set("boundary", JSON.stringify(points));
    const r = await saveCampusBoundary(undefined, fd);
    if (r?.error) { setMsg({ tone: "bad", text: r.error }); return; }
    setMsg({ tone: "ok", text: r?.ok ?? "Saved." });
    setEditing(null);
    setPoints([]);
    router.refresh();
  }

  async function createCampus() {
    if (!map) return;
    const c = map.getCenter();
    const fd = new FormData();
    fd.set("name", newCampus);
    fd.set("lat", String(c.lat));
    fd.set("lng", String(c.lng));
    const r = await addCampus(undefined, fd);
    setMsg(r?.error ? { tone: "bad", text: r.error } : { tone: "ok", text: r?.ok ?? "Added." });
    if (!r?.error) { setNewCampus(""); router.refresh(); }
  }

  const onCampus = rows.filter((r) => r.mode === "campus").length;
  const safety = rows.length - onCampus;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="overflow-hidden p-0 lg:col-span-2">
        <div ref={ref} className="h-[520px] w-full" role="application" aria-label="Campus map" />
      </Card>
      <div className="space-y-6">
        <Card>
          <CardTitle action={<span className="text-xs text-muted">refreshes every 15 s</span>}>Sharing now</CardTitle>
          <div className="mb-3 flex gap-2 text-sm">
            <Badge status="active">{onCampus} on campus</Badge>
            {safety > 0 && <span className="inline-flex rounded-full bg-warn/10 px-2.5 py-0.5 text-xs font-medium text-warn">{safety} safety sharing</span>}
          </div>
          {loadError && <Notice tone="bad">{loadError}</Notice>}
          <ul className="max-h-64 divide-y divide-line overflow-y-auto text-sm">
            {rows.length === 0 && <li className="py-6 text-center text-muted">Nobody is sharing right now.</li>}
            {rows.map((r) => (
              <li key={r.user_id}>
                <button className="flex w-full items-center justify-between gap-2 py-2 text-left hover:bg-bg"
                  onClick={() => map?.setView([r.lat, r.lng], 18)}>
                  <span>
                    <span className="block font-medium">{r.full_name ?? "Student"}</span>
                    <span className="text-xs text-muted">{r.student_number ?? ""} · {r.mode === "safety" ? "safety, off campus" : r.campus_name ?? "on campus"}</span>
                  </span>
                  <span className="text-xs text-muted">{ago(r.updated_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardTitle>Campus boundaries</CardTitle>
          {msg && <div className="mb-3"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
          {!editing ? (
            <div className="space-y-3">
              {campuses.length > 0 && (
                <div className="flex gap-2">
                  <Select aria-label="Campus" defaultValue="" onChange={(e) => e.target.value && startEdit(e.target.value)}>
                    <option value="" disabled>Edit boundary of…</option>
                    {campuses.map((c) => <option key={c.id} value={c.id}>{c.name}{isRing(c.boundary) ? "" : " (no boundary)"}</option>)}
                  </Select>
                </div>
              )}
              <div className="flex gap-2">
                <Input placeholder="New campus name" value={newCampus} onChange={(e) => setNewCampus(e.target.value)} />
                <Button variant="secondary" onClick={createCampus} disabled={newCampus.trim().length < 2}>Add</Button>
              </div>
              <p className="text-xs text-muted">A new campus is placed at the centre of the map. Move the map to it first.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm">Click the map to add each corner of <b>{campuses.find((c) => c.id === editing)?.name}</b>. {points.length} point{points.length === 1 ? "" : "s"}.</p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={saveBoundary} disabled={points.length < 3}>Save boundary</Button>
                <Button variant="secondary" onClick={() => setPoints((p) => p.slice(0, -1))} disabled={!points.length}>Undo</Button>
                <Button variant="secondary" onClick={() => setPoints([])} disabled={!points.length}>Clear</Button>
                <Button variant="ghost" onClick={() => { setEditing(null); setPoints([]); }}>Cancel</Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
