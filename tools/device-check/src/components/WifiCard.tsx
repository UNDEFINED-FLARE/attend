import { useEffect, useState } from "react";
import { Network, type ConnectionStatus } from "@capacitor/network";
import { Card, Note, Row, StatusPill } from "./Card";
import { DeviceStatus, type DeviceStatusInfo } from "../lib/deviceStatus";
import { errorText, isNative, type Level, type Report } from "../lib/platform";

export function WifiCard(props: { status: DeviceStatusInfo | null; refresh: () => Promise<void>; report: Report }) {
  const { status, refresh, report } = props;
  const [net, setNet] = useState<ConnectionStatus | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Live updates: Wi-Fi turning on/off or switching networks.
  useEffect(() => {
    Network.getStatus().then(setNet, (e) => setMsg(errorText(e)));
    const handle = Network.addListener("networkStatusChange", (s) => {
      setNet(s);
      void refresh();
    });
    return () => {
      void handle.then((h) => h.remove());
    };
  }, [refresh]);

  const wifi = status?.wifi;
  // Browsers only report the real medium (wifi/cellular) on Chrome for Android.
  // Elsewhere the web Network plugin guesses from speed, so don't trust it.
  const browserType = (navigator as Navigator & { connection?: { type?: string } }).connection?.type;
  const type = isNative ? net?.connectionType : browserType ?? "unknown";
  let level: Level = "idle";
  if (net) {
    if (isNative) level = wifi?.enabled === false ? "fail" : net.connectionType === "wifi" ? "ok" : "warn";
    else if (!net.connected) level = "fail";
    else if (type === "wifi") level = "ok";
    else if (type !== "unknown") level = "warn";
  }
  const unknownInBrowser = !isNative && net?.connected && type === "unknown";
  useEffect(() => report("wifi", level), [level, report]);

  async function openSettings() {
    setMsg(null);
    try {
      await DeviceStatus.openWifiSettings();
    } catch (e) {
      setMsg(errorText(e));
    }
  }

  const ssid = wifi?.ssid ?? (net?.connectionType === "wifi" ? "Hidden" : "-");
  return (
    <Card
      id="card-wifi"
      icon="📶"
      title="Wi-Fi"
      pill={<StatusPill level={level} text={unknownInBrowser ? "Online · type unknown" : undefined} />}
      actions={
        <>
          <button onClick={() => void refresh().then(() => Network.getStatus().then(setNet))}>Refresh</button>
          {isNative && <button className="primary" onClick={openSettings}>Open Wi-Fi settings</button>}
        </>
      }
    >
      <Row label="Internet" value={net ? (net.connected ? "Online" : "Offline") : "Checking…"} />
      <Row label="Connection type" value={!net ? "-" : type === "unknown" ? "Browser doesn't say" : type} />
      {isNative && <Row label="Wi-Fi radio" value={wifi?.enabled == null ? "-" : wifi.enabled ? "On" : "Off"} />}
      {isNative && <Row label="Network name" value={ssid} />}
      {wifi?.note && <Note>{wifi.note}</Note>}
      {isNative && <Note>Android doesn't let apps switch Wi-Fi on or off. "Open Wi-Fi settings" shows the system Wi-Fi panel instead.</Note>}
      {msg && <Note tone="warn">{msg}</Note>}
    </Card>
  );
}
