"use client";
import type * as Leaflet from "leaflet";
import { useEffect, useMemo, useRef } from "react";
import { FALLBACK_CENTER, type LatLng } from "@/lib/campuses";
import { BRAND, drawVenue, INFO, OK, useLeaflet, WARN, type Venueish } from "./use-leaflet";

/**
 * Read-only map of one venue, optionally with the viewer's own position.
 * The position is the one this device just measured; it is drawn here and
 * nowhere else (the server keeps only the distance).
 */
export function VenueMap({ venue, me, height = 260 }: {
  venue: Venueish;
  me?: { center: LatLng; accuracy: number; inside: boolean } | null;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const start = useMemo<LatLng>(
    () => (venue.lat != null && venue.lng != null ? [venue.lat, venue.lng] : venue.polygon?.[0] ?? FALLBACK_CENTER),
    [venue]);
  const m = useLeaflet(ref, start, 17);

  useEffect(() => {
    if (!m) return;
    const { map, L } = m;
    const g = L.layerGroup().addTo(map);
    const shape = drawVenue(L, g, venue, BRAND, { weight: 3 });
    const bounds: Leaflet.LatLngBounds | null = shape && "getBounds" in shape ? (shape as Leaflet.Polygon).getBounds() : null;
    if (me) {
      const color = me.inside ? OK : WARN;
      L.circle(me.center, { radius: me.accuracy, color, weight: 1, fillOpacity: 0.12, interactive: false }).addTo(g);
      L.circleMarker(me.center, { radius: 7, color: "#fff", weight: 2, fillColor: color, fillOpacity: 1 })
        .bindTooltip("You (this phone's estimate)", { permanent: false }).addTo(g);
      const b = (bounds ?? L.latLngBounds([start, start])).extend(me.center);
      map.fitBounds(b.pad(0.4), { maxZoom: 18 });
    } else if (bounds) {
      map.fitBounds(bounds.pad(0.6), { maxZoom: 18 });
    }
    return () => { g.remove(); };
  }, [m, venue, me, start]);

  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <div ref={ref} style={{ height }} className="z-0 w-full bg-bg" role="img" aria-label={`Map of ${venue.name}`} />
      <div className="flex flex-wrap gap-x-4 gap-y-1 bg-surface px-3 py-2 text-xs text-muted">
        <span><i className="mr-1 inline-block size-2.5 rounded-sm align-middle" style={{ background: BRAND }} />{venue.name}</span>
        {me && <span><i className="mr-1 inline-block size-2.5 rounded-full align-middle" style={{ background: me.inside ? OK : WARN }} />You, ±{Math.round(me.accuracy)} m</span>}
        {!me && <span style={{ color: INFO }}>Students must be inside this area for the location check.</span>}
      </div>
    </div>
  );
}
