"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { INFO, useLeaflet } from "@/components/map/use-leaflet";
import { Button, Card, LinkButton, Notice, Select } from "@/components/ui";
import { bearingDeg, compass, distanceM, fmtDistance, fmtMinutes, nearestOnLine, type LatLng } from "@/lib/geo";
import type { RouteResult } from "@/lib/route";

export type Destination = { id: string; name: string; code: string | null; lat: number; lng: number; radius_m: number | null };
export type NextClass = { module_code: string; module_title: string; venue_id: string | null; venue_name: string | null; starts_at: string };

const OFF_ROUTE_M = 35;       // further than this from the line → re-route
const REROUTE_EVERY_MS = 20_000;
const ARRIVE_MIN_M = 20;

const classTime = (iso: string) =>
  new Date(iso).toLocaleString("en-ZA", { weekday: "short", hour: "2-digit", minute: "2-digit" });

/** Metres left along the route from segment `seg` (starting at point p) to the end. */
function remainingAlong(line: LatLng[], seg: number, p: LatLng) {
  let m = line[seg + 1] ? distanceM(p, line[seg + 1]) : 0;
  for (let i = seg + 1; i < line.length - 1; i++) m += distanceM(line[i], line[i + 1]);
  return m;
}

export function Navigator({ classes, venues, outlines }: { classes: NextClass[]; venues: Destination[]; outlines: LatLng[][] }) {
  const firstClassVenue = classes.find((c) => c.venue_id && venues.some((v) => v.id === c.venue_id))?.venue_id;
  const [destId, setDestId] = useState(firstClassVenue ?? venues[0].id);
  const dest = venues.find((v) => v.id === destId) ?? venues[0];
  const destPt = useMemo<LatLng>(() => [dest.lat, dest.lng], [dest.lat, dest.lng]);

  const ref = useRef<HTMLDivElement>(null);
  const leaflet = useLeaflet(ref, destPt, 17, { scrollWheelZoom: true });
  const L = leaflet?.L ?? null;
  const map = leaflet?.map ?? null;
  const [navigating, setNavigating] = useState(false);
  const [here, setHere] = useState<{ p: LatLng; accuracy: number } | null>(null);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastRoute = useRef(0);
  const routing = useRef(false);
  const layers = useRef<{ route?: Leaflet.Layer; me?: Leaflet.LayerGroup; dest?: Leaflet.Layer }>({});

  // Campus outlines (static).
  useEffect(() => {
    if (!L || !map) return;
    const g = L.layerGroup().addTo(map);
    outlines.filter((r) => r.length >= 3).forEach((r) => L.polygon(r, { color: INFO, weight: 1, fillOpacity: 0.04, interactive: false }).addTo(g));
    return () => { g.remove(); };
  }, [L, map, outlines]);

  // Destination marker.
  useEffect(() => {
    if (!L || !map) return;
    layers.current.dest?.remove();
    layers.current.dest = L.circleMarker(destPt, { radius: 9, color: "#fff", weight: 2, fillColor: "#dc2626", fillOpacity: 1 })
      .bindTooltip(dest.code ? `${dest.name} (${dest.code})` : dest.name, { permanent: true, direction: "top", offset: [0, -8] })
      .addTo(map);
    if (!navigating) map.setView(destPt, 17);
  }, [L, map, destPt, dest.name, dest.code, navigating]);

  const fetchRoute = useCallback(async (from: LatLng) => {
    if (routing.current) return;
    routing.current = true;
    lastRoute.current = Date.now();
    try {
      const res = await fetch("/api/route", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: destPt }),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "Could not get directions.");
      else { setError(null); setRoute(body as RouteResult); }
    } catch {
      setError("No connection. Showing your position only.");
    } finally {
      routing.current = false;
    }
  }, [destPt]);

  // Follow the student's position while navigating.
  useEffect(() => {
    if (!navigating) return;
    if (!("geolocation" in navigator)) { setError("This device cannot share its location."); return; }
    const watch = navigator.geolocation.watchPosition(
      (pos) => setHere({ p: [pos.coords.latitude, pos.coords.longitude], accuracy: pos.coords.accuracy }),
      (err) => setError(err.code === err.PERMISSION_DENIED
        ? "Location permission is off. Allow location for UniAttend to get directions."
        : "Your location is not available right now."),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [navigating]);

  // First fix → route. Later: re-route when clearly off the line.
  const progress = useMemo(() => (here && route ? nearestOnLine(here.p, route.line) : null), [here, route]);
  useEffect(() => {
    if (!navigating || !here) return;
    const off = progress ? progress.distance > Math.max(OFF_ROUTE_M, here.accuracy) : true;
    if ((!route || off) && Date.now() - lastRoute.current > (route ? REROUTE_EVERY_MS : 0)) void fetchRoute(here.p);
  }, [navigating, here, route, progress, fetchRoute]);

  // New destination → drop the old route.
  useEffect(() => { setRoute(null); lastRoute.current = 0; }, [destId]);

  // Draw route + me.
  useEffect(() => {
    if (!L || !map) return;
    layers.current.route?.remove();
    if (route) {
      layers.current.route = L.polyline(route.line, {
        color: route.mode === "walking" ? "#2563eb" : "#64748b", weight: 6, opacity: 0.8,
        dashArray: route.mode === "direct" ? "8 8" : undefined,
      }).addTo(map);
    }
  }, [L, map, route]);
  useEffect(() => {
    if (!L || !map || !here) return;
    layers.current.me?.remove();
    const g = L.layerGroup().addTo(map);
    L.circle(here.p, { radius: Math.min(here.accuracy, 150), color: "#2563eb", weight: 0, fillOpacity: 0.15 }).addTo(g);
    L.circleMarker(here.p, { radius: 8, color: "#fff", weight: 3, fillColor: "#2563eb", fillOpacity: 1 }).addTo(g);
    layers.current.me = g;
    if (navigating) map.panTo(here.p, { animate: true });
  }, [L, map, here, navigating]);

  const toDest = here ? distanceM(here.p, destPt) : null;
  const arrived = toDest != null && toDest <= Math.max(dest.radius_m ?? ARRIVE_MIN_M, ARRIVE_MIN_M);
  const left = here && route && progress ? (route.mode === "walking" ? remainingAlong(route.line, progress.segment, here.p) : toDest ?? 0) : null;
  const stepIndex = route && progress ? route.steps.findIndex((s) => progress.segment >= s.from && progress.segment < Math.max(s.to, s.from + 1)) : -1;
  const step = stepIndex >= 0 && route ? route.steps[stepIndex] : null;

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        {classes.length > 0 && (
          <div className="text-sm">
            <span className="text-muted">Next class: </span>
            <b>{classes[0].module_code}</b> {classes[0].module_title} · {classTime(classes[0].starts_at)}
            {classes[0].venue_name ? <> · {classes[0].venue_name}</> : <span className="text-muted"> · no venue set</span>}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Select aria-label="Destination" value={destId} onChange={(e) => setDestId(e.target.value)} className="flex-1">
            {classes.filter((c) => c.venue_id).length > 0 && (
              <optgroup label="My classes">
                {classes.filter((c) => c.venue_id).map((c) => (
                  <option key={`${c.module_code}-${c.starts_at}`} value={c.venue_id ?? ""}>{c.module_code} · {classTime(c.starts_at)} · {c.venue_name}</option>
                ))}
              </optgroup>
            )}
            <optgroup label="All venues">
              {venues.map((v) => <option key={v.id} value={v.id}>{v.name}{v.code ? ` (${v.code})` : ""}</option>)}
            </optgroup>
          </Select>
          {!navigating
            ? <Button onClick={() => { setError(null); setNavigating(true); }}>Start</Button>
            : <Button variant="secondary" onClick={() => { setNavigating(false); setRoute(null); setHere(null); }}>Stop</Button>}
        </div>
      </Card>

      {navigating && (
        <div aria-live="polite" className="space-y-2">
          {arrived ? (
            <Notice tone="ok">
              You have arrived at <b>{dest.name}</b>.{" "}
              <LinkButton href="/student/check-in" className="ml-2 h-8">Check in</LinkButton>
            </Notice>
          ) : !here ? (
            <Notice>Finding your location…</Notice>
          ) : route?.mode === "walking" && step ? (
            <Card className="p-4">
              <p className="text-lg font-semibold">{step.instruction || "Continue"}</p>
              <p className="text-sm text-muted">{left != null && <>{fmtDistance(left)} to go · about {fmtMinutes(left / 1.3)}</>}</p>
            </Card>
          ) : route && toDest != null ? (
            <Card className="p-4">
              <p className="text-lg font-semibold">Head {compass(bearingDeg(here.p, destPt))}</p>
              <p className="text-sm text-muted">{fmtDistance(toDest)} in a straight line · about {fmtMinutes(toDest / 1.3)}</p>
            </Card>
          ) : null}
          {route?.notice && <Notice tone="warn">{route.notice}</Notice>}
          {error && <Notice tone="bad">{error}</Notice>}
        </div>
      )}

      <Card className="overflow-hidden p-0">
        <div ref={ref} className="h-[420px] w-full" role="application" aria-label="Map with walking route" />
      </Card>

      {navigating && route?.mode === "walking" && route.steps.length > 0 && (
        <Card>
          <ol className="space-y-2 text-sm">
            {route.steps.map((s, i) => (
              <li key={i} className={i === stepIndex ? "font-semibold" : i < stepIndex ? "text-muted line-through" : ""}>
                {s.instruction} <span className="text-muted">· {fmtDistance(s.distance)}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}
      <p className="text-xs text-muted">
        Directions guide you to the venue&apos;s building, not to a room inside it. Your location is used on this phone and
        only your start and end points are sent (without your name) to calculate the route. Nothing is stored.
      </p>
    </div>
  );
}
