import { useEffect, useState } from "react";
import { Card, Note, Row, StatusPill } from "./Card";
import { DeviceStatus, type DeviceStatusInfo, type NearbyDevice } from "../lib/deviceStatus";
import { errorText, isNative, type Level, type Report } from "../lib/platform";

const SCAN_SECONDS = 8;

export function BluetoothCard(props: { status: DeviceStatusInfo | null; refresh: () => Promise<void>; report: Report }) {
  const { status, refresh, report } = props;
  const [devices, setDevices] = useState<NearbyDevice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const bt = status?.bluetooth;
  let level: Level = "idle";
  if (bt) {
    if (!bt.supported) level = "fail";
    else if (isNative) level = bt.enabled ? "ok" : "warn";
    else level = devices?.length ? "ok" : bt.enabled === false ? "warn" : "idle";
  }
  useEffect(() => report("bt", level), [level, report]);

  async function turnOn() {
    setMsg(null);
    try {
      const r = await DeviceStatus.requestBluetoothEnable();
      setMsg(r.enabled ? "Bluetooth is on." : "Bluetooth is still off.");
      await refresh();
    } catch (e) {
      setMsg(errorText(e));
    }
  }

  async function scan() {
    setMsg(isNative ? `Scanning for ${SCAN_SECONDS} seconds…` : null);
    setBusy(true);
    try {
      const r = await DeviceStatus.scanBluetooth({ seconds: SCAN_SECONDS });
      const sorted = [...r.devices].sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));
      setDevices(sorted);
      setMsg(sorted.length ? `Found ${sorted.length} device(s).` : "No devices found nearby.");
    } catch (e) {
      setMsg(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function openSettings() {
    try {
      await DeviceStatus.openBluetoothSettings();
    } catch (e) {
      setMsg(errorText(e));
    }
  }

  const enabledText = !bt ? "Checking…" : !bt.supported ? "Not available" : bt.enabled == null ? "Unknown" : bt.enabled ? "On" : "Off";
  return (
    <Card
      id="card-bt"
      icon="🔵"
      title="Bluetooth"
      pill={<StatusPill level={level} />}
      actions={
        bt?.supported ? (
          <>
            {isNative && !bt.enabled && <button className="primary" onClick={turnOn}>Turn on Bluetooth</button>}
            <button className={isNative && !bt.enabled ? "" : "primary"} onClick={scan} disabled={busy || (isNative && !bt.enabled)}>
              {busy ? "Scanning…" : isNative ? `Scan nearby (${SCAN_SECONDS} s)` : "Find a nearby device"}
            </button>
            {isNative && <button onClick={openSettings}>Bluetooth settings</button>}
          </>
        ) : undefined
      }
    >
      <Row label="Bluetooth" value={enabledText} />
      {bt?.note && <Note tone={bt.supported ? "idle" : "fail"}>{bt.note}</Note>}
      {devices && devices.length > 0 && (
        <ul className="devices">
          {devices.slice(0, 12).map((d) => (
            <li key={d.address}>
              <span>{d.name ?? "Unnamed device"}</span>
              <small>{d.rssi != null ? `${d.rssi} dBm` : d.address}</small>
            </li>
          ))}
        </ul>
      )}
      {msg && <Note tone={level === "fail" ? "fail" : "idle"}>{msg}</Note>}
    </Card>
  );
}
