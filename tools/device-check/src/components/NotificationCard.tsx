import { useEffect, useState } from "react";
import { Haptics } from "@capacitor/haptics";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Card, Note, Row, StatusPill } from "./Card";
import { errorText, isNative, type Level, type Report } from "../lib/platform";
import { playChime, webVibrate } from "../lib/sound";

// High-importance channel: heads-up banner, default notification sound, vibration.
const CHANNEL = "uniattend-alerts";

type Perm = "granted" | "denied" | "prompt" | "unsupported";
const PERM_LABEL: Record<Perm, string> = {
  granted: "Allowed",
  denied: "Blocked",
  prompt: "Not asked yet",
  unsupported: "Not supported",
};

async function readPermission(): Promise<Perm> {
  if (isNative) {
    const p = await LocalNotifications.checkPermissions();
    return p.display === "granted" ? "granted" : p.display === "denied" ? "denied" : "prompt";
  }
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission === "default" ? "prompt" : Notification.permission;
}

async function askPermission(): Promise<Perm> {
  if (isNative) {
    const p = await LocalNotifications.requestPermissions();
    return p.display === "granted" ? "granted" : "denied";
  }
  if (!("Notification" in window)) return "unsupported";
  return (await Notification.requestPermission()) === "granted" ? "granted" : "denied";
}

export function NotificationCard({ report }: { report: Report }) {
  const [perm, setPerm] = useState<Perm>("prompt");
  const [level, setLevel] = useState<Level>("idle");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    readPermission().then(setPerm, () => setPerm("unsupported"));
  }, []);
  useEffect(() => report("notif", level), [level, report]);

  async function sendTest() {
    setMsg(null);
    try {
      const p = perm === "granted" ? perm : await askPermission();
      setPerm(p);
      if (isNative) {
        if (p !== "granted") {
          setLevel("warn");
          setMsg("Notifications are blocked. Allow them in Settings → Apps → UniAttend Check → Notifications.");
          return;
        }
        await LocalNotifications.createChannel({
          id: CHANNEL,
          name: "UniAttend alerts",
          description: "Session and attendance alerts",
          importance: 5,
          visibility: 1,
          vibration: true,
          lights: true,
        });
        await LocalNotifications.schedule({
          notifications: [
            {
              id: Math.floor(Date.now() / 1000) % 1_000_000,
              title: "UniAttend: session open",
              body: "CS101 is open. Check in now. (Test notification)",
              channelId: CHANNEL,
            },
          ],
        });
        await Haptics.vibrate({ duration: 400 });
        setLevel("ok");
        setMsg("Sent. You should hear the notification sound, feel a vibration and see it in the notification shade.");
      } else {
        if (p === "granted") {
          new Notification("UniAttend: session open", { body: "CS101 is open. Check in now. (Test notification)" });
        }
        const vibrated = webVibrate([200, 100, 200]);
        const sound = await playChime();
        setLevel(p === "granted" ? "ok" : "warn");
        setMsg(
          [
            p === "granted" ? "Notification shown." : "Notifications are blocked for this site.",
            sound ? "Sound played." : "Sound is blocked until you tap the page (browser rule).",
            vibrated ? "Vibrated." : "This browser can't vibrate (Chrome on Android can).",
          ].join(" "),
        );
      }
    } catch (e) {
      setLevel("fail");
      setMsg(errorText(e));
    }
  }

  async function vibrateOnly() {
    setMsg(null);
    try {
      if (isNative) {
        await Haptics.vibrate({ duration: 800 });
        setMsg("Vibrated for 0.8 s.");
      } else {
        setMsg(webVibrate([300, 150, 300]) ? "Vibrated." : "This browser can't vibrate (Chrome on Android can).");
      }
    } catch (e) {
      setMsg(errorText(e));
    }
  }

  async function soundOnly() {
    setMsg((await playChime()) ? "Played the test chime." : "Sound is blocked or not supported in this browser.");
  }

  return (
    <Card
      id="card-notif"
      icon="🔔"
      title="Notifications"
      pill={<StatusPill level={level} />}
      actions={
        <>
          <button className="primary" onClick={sendTest}>Send test notification</button>
          <button onClick={vibrateOnly}>Vibrate</button>
          <button onClick={soundOnly}>Play sound</button>
        </>
      }
    >
      <Row label="Permission" value={PERM_LABEL[perm]} />
      <Row label="Sound + vibration" value={isNative ? "Android notification channel" : "Browser chime + vibrate"} />
      {msg && <Note tone={level}>{msg}</Note>}
    </Card>
  );
}
