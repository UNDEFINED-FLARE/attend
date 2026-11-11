import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { Card, Note, Row, StatusPill } from "./Card";
import type { Fix } from "../lib/platform";

// OpenStreetMap tiles through Leaflet: Google-Maps-style pan/zoom with no API
// key or billing. Tap the map to place a "classroom" pin, then see whether the
// phone is inside the check-in radius, as UniAttend's GPS check will.

interface Point {
  lat: number;
  lng: number;
}

const classroomIcon = L.divIcon({ className: "classroom-pin", html: "🏫", iconSize: [32, 32], iconAnchor: [16, 30] });

export function MapCard({ position }: { position: Fix | null }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const me = useRef<{ dot: L.CircleMarker; ring: L.Circle } | null>(null);
  const room = useRef<{ pin: L.Marker; ring: L.Circle } | null>(null);
  const centredOnce = useRef(false);
  const [classroom, setClassroom] = useState<Point | null>(null);
  const [radius, setRadius] = useState(100);

  // Create the map once.
  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true }).setView([20, 0], 2);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m);
    m.on("click", (e: L.LeafletMouseEvent) => setClassroom({ lat: e.latlng.lat, lng: e.latlng.lng }));
    map.current = m;
    setTimeout(() => m.invalidateSize(), 0);
    return () => {
      m.remove();
      map.current = null;
      me.current = null;
      room.current = null;
    };
  }, []);

  // Show / move "my location".
  useEffect(() => {
    const m = map.current;
    if (!m || !position) return;
    const ll: L.LatLngExpression = [position.lat, position.lng];
    if (!me.current) {
      me.current = {
        ring: L.circle(ll, { radius: position.accuracy, color: "#1a73e8", weight: 1, fillOpacity: 0.12 }).addTo(m),
        dot: L.circleMarker(ll, { radius: 8, color: "#fff", weight: 3, fillColor: "#1a73e8", fillOpacity: 1 }).addTo(m),
      };
    } else {
      me.current.dot.setLatLng(ll);
      me.current.ring.setLatLng(ll).setRadius(position.accuracy);
    }
    if (!centredOnce.current) {
      centredOnce.current = true;
      m.setView(ll, 17);
    }
  }, [position]);

  // Show / move the classroom pin and its check-in radius.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!classroom) {
      room.current?.pin.remove();
      room.current?.ring.remove();
      room.current = null;
      return;
    }
    const ll: L.LatLngExpression = [classroom.lat, classroom.lng];
    if (!room.current) {
      room.current = {
        ring: L.circle(ll, { radius, color: "#e8710a", weight: 2, dashArray: "6 6", fillOpacity: 0.08 }).addTo(m),
        pin: L.marker(ll, { icon: classroomIcon }).addTo(m),
      };
    } else {
      room.current.pin.setLatLng(ll);
      room.current.ring.setLatLng(ll).setRadius(radius);
    }
  }, [classroom, radius]);

  const distance = position && classroom ? L.latLng(position.lat, position.lng).distanceTo(L.latLng(classroom.lat, classroom.lng)) : null;
  const inside = distance != null && distance <= radius;

  return (
    <Card
      id="card-map"
      icon="🗺️"
      title="Map & classroom check"
      wide
      pill={
        distance == null ? (
          <StatusPill level="idle" text={classroom ? "Waiting for GPS" : "No classroom set"} />
        ) : (
          <StatusPill level={inside ? "ok" : "warn"} text={inside ? "Inside" : "Outside"} />
        )
      }
      actions={
        <>
          <button
            onClick={() => position && map.current?.setView([position.lat, position.lng], 17)}
            disabled={!position}
          >
            Centre on me
          </button>
          <button
            className="primary"
            onClick={() => position && setClassroom({ lat: position.lat, lng: position.lng })}
            disabled={!position}
          >
            Classroom = my location
          </button>
          <button onClick={() => setClassroom(null)} disabled={!classroom}>Clear pin</button>
        </>
      }
    >
      <div ref={el} className="map" role="application" aria-label="Map" />
      <label className="slider">
        <span>Check-in radius: <strong>{radius} m</strong></span>
        <input type="range" min={25} max={500} step={25} value={radius} onChange={(e) => setRadius(Number(e.target.value))} />
      </label>
      {distance != null && (
        <Row
          label="Distance to classroom"
          value={inside ? `${Math.round(distance)} m (inside)` : `${Math.round(distance)} m (${Math.round(distance - radius)} m outside)`}
        />
      )}
      <Note>
        {position ? "Tap the map to place the classroom pin." : 'Press "Get my location" in the GPS card to show where you are.'} The map needs an internet connection.
      </Note>
    </Card>
  );
}
