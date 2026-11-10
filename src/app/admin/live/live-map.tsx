"use client";
import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { drawVenue, INFO, OK, useLeaflet, WARN, type Venueish } from "@/components/map/use-leaflet";
import { Badge, Card, CardTitle, Notice } from "@/components/ui";
import { FALLBACK_CENTER, FALLBACK_ZOOM, type Campus } from "@/lib/campuses";
import { supabaseBrowser } from "@/lib/supabase/client";

export type LiveVenue = Venueish & { id: string };
type Live = {
  user_id: string; full_name: string | null; student_number: string | null; lat: number; lng: number;
  accuracy_m: number; on_campus: boolean; campus_name: string | null; mode: "campus" | "safety"; updated_at: string;
};

const POLL_MS = 15_000;
const STALE = "#94a3b8";

const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};

export function LiveMap({ institutionId, intervalS, campuses, venues }: {
  institutionId: string; intervalS: number; campuses: Campus[]; venues: LiveVenue[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const first = campuses[0];
  const leaflet = useLeaflet(ref, first?.center ?? FALLBACK_CENTER, first?.zoom ?? FALLBACK_ZOOM, { scrollWheelZoom: true });
  const [rows, setRows] = useState<Live[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const people = useRef<Leaflet.LayerGroup | null>(null);

  // Static layers: campus outlines and venues.
  useEffect(() => {
    if (!leaflet) return;
    const { L, map } = leaflet;
    const g = L.layerGroup().addTo(map);
    for (const c of campuses) {
      if (c.outline && c.outline.length >= 3) L.polygon(c.outline, { color: INFO, weight: 2, fillOpacity: 0.04, interactive: false }).addTo(g);
    }
    for (const v of venues) drawVenue(L, g, v, "#475569", { weight: 1 });
    if (first) map.fitBounds([[first.bbox[0], first.bbox[1]], [first.bbox[2], first.bbox[3]]]);
    return () => { g.remove(); };
  }, [leaflet, campuses, venues, first]);

  // Poll live positions. RLS makes sure an admin only gets their own institution.
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

  // People: green on campus, amber safety sharing, grey when older than 3 update intervals.
  useEffect(() => {
    if (!leaflet) return;
    const { L, map } = leaflet;
    people.current?.remove();
    const g = L.layerGroup().addTo(map);
    people.current = g;
    for (const r of rows) {
      const stale = Date.now() - new Date(r.updated_at).getTime() > intervalS * 3000;
      const color = stale ? STALE : r.mode === "safety" ? WARN : OK;
      L.circle([r.lat, r.lng], { radius: Math.min(r.accuracy_m, 200), color, weight: 0, fillOpacity: 0.12, interactive: false }).addTo(g);
      L.circleMarker([r.lat, r.lng], { radius: 7, color: "#fff", weight: 2, fillColor: color, fillOpacity: 1 })
        .bindTooltip(`${r.full_name ?? "Student"}${r.student_number ? ` · ${r.student_number}` : ""}<br>${r.mode === "safety" ? "Safety sharing (off campus)" : r.campus_name ?? "On campus"} · ${ago(r.updated_at)}`)
        .addTo(g);
    }
  }, [leaflet, rows, intervalS]);

  const onCampus = rows.filter((r) => r.mode === "campus").length;
  const safety = rows.length - onCampus;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="overflow-hidden p-0 lg:col-span-2">
        <div ref={ref} className="h-[520px] w-full" role="application" aria-label="Live campus map" />
      </Card>
      <Card>
        <CardTitle action={<span className="text-xs text-muted">refreshes every 15 s</span>}>Sharing now</CardTitle>
        <div className="mb-3 flex gap-2 text-sm">
          <Badge status="active">{onCampus} on campus</Badge>
          {safety > 0 && <span className="inline-flex rounded-full bg-warn/10 px-2.5 py-0.5 text-xs font-medium text-warn">{safety} safety sharing</span>}
        </div>
        {loadError && <Notice tone="bad">{loadError}</Notice>}
        <ul className="max-h-[440px] divide-y divide-line overflow-y-auto text-sm">
          {rows.length === 0 && <li className="py-6 text-center text-muted">Nobody is sharing right now.</li>}
          {rows.map((r) => (
            <li key={r.user_id}>
              <button className="flex w-full items-center justify-between gap-2 py-2 text-left hover:bg-bg"
                onClick={() => leaflet?.map.setView([r.lat, r.lng], 18)}>
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
    </div>
  );
}
