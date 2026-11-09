"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { campusesFor, distanceM, insidePolygon, type LatLng } from "@/lib/campuses";
import { BRAND, drawVenue, OK, useLeaflet, type Venueish } from "./use-leaflet";

export type MapVenue = Venueish & { id: string };
export type MapClass = { venue_id: string | null; code: string; title: string; kind: string; starts_at: string; ends_at: string; mine: boolean; live: boolean;
  lecturer?: string | null; venue_name?: string | null; day?: "today" | "tomorrow" };

const ACCENT = "#2f6fed";
const WALK_M_PER_MIN = 80;

function inside(p: LatLng, v: MapVenue) {
  if (v.polygon && v.polygon.length >= 3) return insidePolygon(p, v.polygon);
  return v.lat != null && v.lng != null && distanceM(p, [v.lat, v.lng]) <= (v.radius_m ?? 50);
}
const centerOf = (v: MapVenue): LatLng | null =>
  v.lat != null && v.lng != null ? [v.lat, v.lng] : v.polygon?.length ? v.polygon[0] : null;

/**
 * Campus map for students: every venue, what is on in it today (their own
 * classes highlighted), and — only if they ask — their live position. The
 * position is used on this screen only; nothing here is sent anywhere.
 */
/** "HH:MM" in South African time, ticking. */
function sastNow() {
  const d = new Date(Date.now() + 2 * 3600_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
const mins = (hhmm: string) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);

export function CampusMap({ venues, classes, upcoming = [], institutionName, now: initialNow }: {
  venues: MapVenue[]; classes: MapClass[]; upcoming?: MapClass[]; institutionName: string | null; now: string;
}) {
  const [now, setNow] = useState(initialNow);
  useEffect(() => { const t = setInterval(() => setNow(sastNow()), 30_000); return () => clearInterval(t); }, []);
  const campus = campusesFor(institutionName)[0];
  const start: LatLng = useMemo(() => {
    const pts = venues.map(centerOf).filter(Boolean) as LatLng[];
    return pts.length ? [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length] : campus.center;
  }, [venues, campus]);
  const ref = useRef<HTMLDivElement>(null);
  const m = useLeaflet(ref, start, 17, { scrollWheelZoom: true });
  const [me, setMe] = useState<{ p: LatLng; acc: number } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);
  const watchId = useRef<number | null>(null);

  const byVenue = useMemo(() => {
    const map = new Map<string, MapClass[]>();
    for (const c of classes) if (c.venue_id) map.set(c.venue_id, [...(map.get(c.venue_id) ?? []), c]);
    return map;
  }, [classes]);
  const activeNow = classes.filter((c) => c.live || (c.starts_at.slice(0, 5) <= now && now < c.ends_at.slice(0, 5)))
    .sort((a, b) => Number(b.mine) - Number(a.mine) || a.code.localeCompare(b.code));
  const nextUp = [
    ...upcoming.filter((c) => c.day !== "tomorrow" && c.ends_at.slice(0, 5) > now),
    ...upcoming.filter((c) => c.day === "tomorrow"),
  ].slice(0, 4);
  const myNext = nextUp.find((c) => c.day !== "tomorrow" && c.venue_id);
  const nextVenue = myNext ? venues.find((v) => v.id === myNext.venue_id) : undefined;
  const hereVenue = me ? venues.find((v) => inside(me.p, v)) : undefined;
  const toNext = me && nextVenue && centerOf(nextVenue) ? distanceM(me.p, centerOf(nextVenue)!) : null;

  // Venues, colour-coded by what is on now.
  useEffect(() => {
    if (!m) return;
    const { map, L } = m;
    const g = L.layerGroup().addTo(map);
    if (campus.outline) L.polygon(campus.outline, { color: "#fff", weight: 2, dashArray: "6 6", fill: false, interactive: false }).addTo(g);
    const bounds: LatLng[] = [];
    // Rooms in one building share its outline, so live labels are grouped per spot.
    const labels = new Map<string, { at: LatLng; codes: string[]; mine: boolean; live: boolean }>();
    for (const v of venues) {
      const list = (byVenue.get(v.id) ?? []).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
      const nowClass = list.find((c) => c.live || (c.starts_at.slice(0, 5) <= now && now < c.ends_at.slice(0, 5)));
      const mine = list.some((c) => c.mine);
      const color = nowClass ? (nowClass.mine ? OK : ACCENT) : mine ? OK : BRAND;
      const shape = drawVenue(L, g, v, color, { label: false, weight: mine ? 3 : 2 });
      if (!shape) continue;
      const rows = list.length
        ? list.map((c) => `<li style="margin:2px 0;${c.mine ? "font-weight:600" : ""}">${c.starts_at.slice(0, 5)}–${c.ends_at.slice(0, 5)} ${esc(c.code)} <span style="color:#64748b">${esc(c.kind)}${c.lecturer ? ` · ${esc(c.lecturer)}` : ""}${c.live ? " · attendance open" : ""}${c.mine ? " · yours" : ""}</span></li>`).join("")
        : `<li style="color:#64748b">No classes today</li>`;
      shape.bindPopup(`<strong>${esc(v.name)}</strong><ul style="margin:6px 0 0;padding-left:16px">${rows}</ul>`);
      shape.bindTooltip(`${v.name}${nowClass ? ` · now: ${nowClass.code}` : ""}`, { sticky: true });
      const c = centerOf(v);
      if (c) bounds.push(c);
      if (c && nowClass) {
        const key = `${c[0].toFixed(5)},${c[1].toFixed(5)}`;
        const l = labels.get(key) ?? { at: c, codes: [], mine: false, live: false };
        if (!l.codes.includes(nowClass.code)) l.codes.push(nowClass.code);
        l.mine ||= nowClass.mine; l.live ||= nowClass.live;
        labels.set(key, l);
      }
    }
    for (const l of labels.values()) {
      const text = l.codes.length > 2 ? `${l.codes.slice(0, 2).join(", ")} +${l.codes.length - 2}` : l.codes.join(", ");
      L.marker(l.at, {
        interactive: false,
        icon: L.divIcon({ className: "", iconSize: [0, 0], html:
          `<div class="ua-label ${l.mine ? "ua-label-mine" : ""}">${l.live ? '<span class="ua-pulse"></span>' : ""}${esc(text)}</div>` }),
      }).addTo(g);
    }
    if (bounds.length > 1) map.fitBounds(L.latLngBounds(bounds).pad(0.25), { maxZoom: 18 });
    return () => { g.remove(); };
  }, [m, venues, byVenue, now, campus]);

  // Live position.
  useEffect(() => {
    if (!m || !me) return;
    const { map, L } = m;
    const g = L.layerGroup().addTo(map);
    L.circle(me.p, { radius: me.acc, color: ACCENT, weight: 1, fillOpacity: 0.1, interactive: false }).addTo(g);
    L.circleMarker(me.p, { radius: 8, color: "#fff", weight: 3, fillColor: ACCENT, fillOpacity: 1 }).bindTooltip("You").addTo(g);
    if (nextVenue && centerOf(nextVenue)) {
      L.polyline([me.p, centerOf(nextVenue)!], { color: OK, weight: 3, dashArray: "6 8", interactive: false }).addTo(g);
    }
    return () => { g.remove(); };
  }, [m, me, nextVenue]);

  useEffect(() => () => { if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current); }, []);

  function toggleLocation() {
    if (watching && watchId.current != null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null; setWatching(false); setMe(null);
      return;
    }
    if (!navigator.geolocation) { setGpsError("This device can't share its location."); return; }
    setGpsError(null);
    setWatching(true);
    let first = true;
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const p: LatLng = [pos.coords.latitude, pos.coords.longitude];
        setMe({ p, acc: pos.coords.accuracy });
        if (first && m) { m.map.flyTo(p, 18, { duration: 0.6 }); first = false; }
      },
      () => { setGpsError("Location is off or not allowed. Turn it on in your browser settings."); setWatching(false); },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
  }

  function focus(v?: MapVenue) {
    const c = v && centerOf(v);
    if (c && m) m.map.flyTo(c, 18, { duration: 0.6 });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="relative">
        <div ref={ref} className="z-0 h-[58dvh] min-h-80 w-full rounded-2xl border border-line bg-bg lg:h-[620px]" aria-label="Campus map" />
        <button type="button" onClick={toggleLocation}
          className={`absolute bottom-4 right-4 z-[400] inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-medium shadow-lg ${watching ? "bg-accent text-white" : "bg-surface text-ink"}`}>
          <Icon name="pin" size={18} />{watching ? "Stop sharing location" : "Show my location"}
        </button>
        <div className="pointer-events-none absolute left-3 top-3 z-[400] flex flex-wrap gap-2 text-[11px]">
          <span className="rounded-full bg-white/90 px-2 py-1 shadow"><i className="mr-1 inline-block size-2 rounded-full" style={{ background: ACCENT }} />class now</span>
          <span className="rounded-full bg-white/90 px-2 py-1 shadow"><i className="mr-1 inline-block size-2 rounded-full" style={{ background: OK }} />your classes</span>
          <span className="rounded-full bg-white/90 px-2 py-1 shadow"><i className="mr-1 inline-block size-2 rounded-full" style={{ background: BRAND }} />other venues</span>
        </div>
      </div>

      <aside className="space-y-4">
        <section className="rounded-2xl bg-surface p-4 shadow-card" aria-live="polite">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Where you are</p>
          {gpsError ? <p className="mt-2 text-sm text-bad">{gpsError}</p>
            : !me ? <p className="mt-2 text-sm text-muted">Tap <b>Show my location</b> to see yourself on the map. Your location stays on this phone.</p>
            : <>
                <p className="mt-2 font-semibold">{hereVenue ? `At ${hereVenue.name}` : "Not inside a mapped venue"}</p>
                <p className="text-xs text-muted">Accuracy ±{Math.round(me.acc)} m</p>
                {myNext && nextVenue && toNext != null && (
                  <p className="mt-2 text-sm">
                    {hereVenue?.id === nextVenue.id ? <>You&apos;re at your next class, <b>{myNext.code}</b>.</>
                      : <><b>{myNext.code}</b> at {myNext.starts_at.slice(0, 5)} in {nextVenue.name}: about {Math.round(toNext)} m, {Math.max(1, Math.round(toNext / WALK_M_PER_MIN))} min walk.</>}
                  </p>
                )}
              </>}
        </section>

        <section className="rounded-2xl bg-surface p-4 shadow-card">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Up next for you</p>
          {nextUp.length === 0 && <p className="text-sm text-muted">No more classes today or tomorrow.</p>}
          <ul className="space-y-2">
            {nextUp.map((c, i) => {
              const v = c.venue_id ? venues.find((x) => x.id === c.venue_id) : undefined;
              const startsIn = c.day === "today" ? mins(c.starts_at) - mins(now) : null;
              const running = c.day === "today" && startsIn != null && startsIn <= 0;
              return (
                <li key={i}>
                  <button type="button" onClick={() => focus(v)} disabled={!v}
                    className={`flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-bg ${i === 0 ? "bg-accent/5 ring-1 ring-accent/30" : ""}`}>
                    <span className="w-16 text-xs font-semibold tabular-nums">
                      {running ? <span className="text-ok">Now</span> : c.day === "tomorrow" ? <>Tmrw<br />{c.starts_at.slice(0, 5)}</> : startsIn! < 60 ? <span className="text-accent">in {startsIn} min</span> : c.starts_at.slice(0, 5)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{c.code} · {c.kind}</span>
                      <span className="block truncate text-xs text-muted">{v?.name ?? c.venue_name ?? "Online / no venue"}{c.lecturer ? ` · ${c.lecturer}` : ""}</span>
                    </span>
                    {v && <Icon name="arrowRight" size={16} className="text-muted" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="rounded-2xl bg-surface p-4 shadow-card">
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
            <span className="size-2 animate-pulse rounded-full bg-ok" />Happening now on campus
          </p>
          {activeNow.length === 0 && <p className="text-sm text-muted">No classes in session right now.</p>}
          <ul className="max-h-56 space-y-1 overflow-y-auto">
            {activeNow.map((c, i) => {
              const v = c.venue_id ? venues.find((x) => x.id === c.venue_id) : undefined;
              return (
                <li key={i}>
                  <button type="button" onClick={() => focus(v)} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-bg">
                    <span className="truncate"><b className={c.mine ? "text-ok" : ""}>{c.code}</b> <span className="text-muted">{v?.name ?? ""}</span></span>
                    <span className="shrink-0 text-xs text-muted">{c.live ? <span className="font-medium text-ok">attendance open</span> : `until ${c.ends_at.slice(0, 5)}`}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="rounded-2xl bg-surface p-4 shadow-card">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">All venues</p>
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {venues.map((v) => {
              const list = byVenue.get(v.id) ?? [];
              const nowC = list.find((c) => c.live || (c.starts_at.slice(0, 5) <= now && now < c.ends_at.slice(0, 5)));
              return (
                <li key={v.id}>
                  <button type="button" onClick={() => focus(v)} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-bg">
                    <span className="truncate">{v.name}</span>
                    <span className={`shrink-0 text-xs ${nowC ? "font-medium text-accent" : "text-muted"}`}>{nowC ? `Now: ${nowC.code}` : `${list.length} today`}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </aside>
    </div>
  );
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
