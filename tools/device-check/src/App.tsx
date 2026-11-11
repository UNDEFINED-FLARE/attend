import { useCallback, useEffect, useState } from "react";
import { BluetoothCard } from "./components/BluetoothCard";
import { GpsCard } from "./components/GpsCard";
import { MapCard } from "./components/MapCard";
import { NotificationCard } from "./components/NotificationCard";
import { WifiCard } from "./components/WifiCard";
import { DeviceStatus, type DeviceStatusInfo } from "./lib/deviceStatus";
import { errorText, platformLabel, type CheckKey, type Fix, type Level, type Report } from "./lib/platform";

const CHECKS: { key: CheckKey; label: string; anchor: string }[] = [
  { key: "notif", label: "Notifications", anchor: "#card-notif" },
  { key: "wifi", label: "Wi-Fi", anchor: "#card-wifi" },
  { key: "bt", label: "Bluetooth", anchor: "#card-bt" },
  { key: "gps", label: "GPS", anchor: "#card-gps" },
];
const ICON: Record<Level, string> = { idle: "○", ok: "✓", warn: "!", fail: "✕" };

export default function App() {
  const [levels, setLevels] = useState<Record<CheckKey, Level>>({ notif: "idle", wifi: "idle", bt: "idle", gps: "idle" });
  const report = useCallback<Report>((key, level) => setLevels((s) => (s[key] === level ? s : { ...s, [key]: level })), []);

  const [status, setStatus] = useState<DeviceStatusInfo | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setStatus(await DeviceStatus.getStatus());
      setStatusError(null);
    } catch (e) {
      setStatusError(errorText(e));
    }
  }, []);

  // Re-check when the user comes back from a system settings screen.
  useEffect(() => {
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const [position, setPosition] = useState<Fix | null>(null);

  return (
    <div className="app">
      <header className="top">
        <h1>UniAttend Check</h1>
        <p>{platformLabel} · tests what UniAttend needs on this device</p>
        <nav className="summary" aria-label="Check results">
          {CHECKS.map((c) => (
            <a key={c.key} href={c.anchor} className={`chip chip-${levels[c.key]}`}>
              <span aria-hidden="true">{ICON[levels[c.key]]}</span> {c.label}
            </a>
          ))}
        </nav>
      </header>
      {statusError && <p className="note note-fail banner">Device status unavailable: {statusError}</p>}
      <main className="grid">
        <NotificationCard report={report} />
        <WifiCard status={status} refresh={refresh} report={report} />
        <BluetoothCard status={status} refresh={refresh} report={report} />
        <GpsCard status={status} refresh={refresh} report={report} position={position} onPosition={setPosition} />
        <MapCard position={position} />
      </main>
    </div>
  );
}
