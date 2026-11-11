import { useEffect, useRef, useState } from "react";
import { Geolocation, type Position } from "@capacitor/geolocation";
import { Card, Note, Row, StatusPill } from "./Card";
import { DeviceStatus, type DeviceStatusInfo } from "../lib/deviceStatus";
import { errorText, isNative, type Fix, type Level, type Report } from "../lib/platform";

const GOOD_ACCURACY_M = 100;
const OPTIONS = { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 };

export function GpsCard(props: {
  status: DeviceStatusInfo | null;
  refresh: () => Promise<void>;
  report: Report;
  position: Fix | null;
  onPosition: (fix: Fix) => void;
}) {
  const { status, refresh, report, position, onPosition } = props;
  const [error, setError] = useState<string | null>(null);
  const [approxOnly, setApproxOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [watching, setWatching] = useState(false);
  const watchId = useRef<string | null>(null);

  const servicesOff = isNative && status?.location.servicesEnabled === false;
  let level: Level = "idle";
  if (error) level = "fail";
  else if (servicesOff) level = "warn";
  else if (position) level = approxOnly || position.accuracy > GOOD_ACCURACY_M ? "warn" : "ok";
  useEffect(() => report("gps", level), [level, report]);

  useEffect(
    () => () => {
      if (watchId.current) void Geolocation.clearWatch({ id: watchId.current });
    },
    [],
  );

  function toFix(p: Position): Fix {
    return { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: p.timestamp };
  }

  /** Native only: ask for location permission. Browsers prompt on first use instead. */
  async function ensurePermission(): Promise<boolean> {
    if (!isNative) return true;
    let p = await Geolocation.checkPermissions();
    if (p.location !== "granted" && p.coarseLocation !== "granted") p = await Geolocation.requestPermissions();
    setApproxOnly(p.location !== "granted" && p.coarseLocation === "granted");
    if (p.location !== "granted" && p.coarseLocation !== "granted") {
      setError("Location permission was denied. Allow it in Settings → Apps → UniAttend Check → Permissions.");
      return false;
    }
    return true;
  }

  async function locate() {
    setError(null);
    setBusy(true);
    try {
      if (!(await ensurePermission())) return;
      onPosition(toFix(await Geolocation.getCurrentPosition(OPTIONS)));
      await refresh(); // location permission also reveals the Wi-Fi network name
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleWatch() {
    setError(null);
    if (watchId.current) {
      await Geolocation.clearWatch({ id: watchId.current });
      watchId.current = null;
      setWatching(false);
      return;
    }
    try {
      if (!(await ensurePermission())) return;
      watchId.current = await Geolocation.watchPosition(OPTIONS, (p, err) => {
        if (err) setError(errorText(err));
        else if (p) onPosition(toFix(p));
      });
      setWatching(true);
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function openSettings() {
    try {
      await DeviceStatus.openLocationSettings();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <Card
      id="card-gps"
      icon="📍"
      title="GPS location"
      pill={<StatusPill level={level} />}
      actions={
        <>
          <button className="primary" onClick={locate} disabled={busy}>{busy ? "Locating…" : "Get my location"}</button>
          <button onClick={toggleWatch}>{watching ? "Stop live tracking" : "Live tracking"}</button>
          {isNative && <button onClick={openSettings}>Location settings</button>}
        </>
      }
    >
      {isNative && (
        <Row label="Location services" value={status?.location.servicesEnabled == null ? "-" : status.location.servicesEnabled ? "On" : "Off"} />
      )}
      <Row label="Latitude" value={position ? position.lat.toFixed(6) : "-"} />
      <Row label="Longitude" value={position ? position.lng.toFixed(6) : "-"} />
      <Row label="Accuracy" value={position ? `± ${Math.round(position.accuracy)} m` : "-"} />
      <Row label="Updated" value={position ? new Date(position.at).toLocaleTimeString() : "-"} />
      {servicesOff && <Note tone="warn">Location is switched off on this phone. Tap "Location settings" to turn it on.</Note>}
      {approxOnly && <Note tone="warn">Only approximate location was allowed. UniAttend needs precise location for check-in.</Note>}
      {position && !approxOnly && position.accuracy > GOOD_ACCURACY_M && (
        <Note tone="warn">Accuracy is weak. Move near a window or outdoors and try again.</Note>
      )}
      {status?.location.note && !isNative && <Note>{status.location.note}</Note>}
      {error && <Note tone="fail">{error}</Note>}
    </Card>
  );
}
