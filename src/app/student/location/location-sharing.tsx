"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, CardTitle, Notice } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";

type Report = { stored: boolean; on_campus?: boolean; reason?: string; mode?: "campus" | "safety"; campus?: string | null };
type Status =
  | { kind: "starting" }
  | { kind: "sharing"; mode: "campus" | "safety"; campus?: string | null; at: Date }
  | { kind: "off_campus"; at: Date }
  | { kind: "disabled" }
  | { kind: "paused" }
  | { kind: "error"; message: string };

const SAFETY_KEY = "ua_safety_sharing";

/**
 * Sends the phone's position to report_location() every `intervalS` seconds
 * while this screen is open. The SERVER decides on/off campus and deletes the
 * position when the student is off campus (unless safety sharing is on).
 */
export function LocationSharing({ institutionId, intervalS, institutionName, consented: initialConsent }: {
  institutionId: string; intervalS: number; institutionName: string; consented: boolean;
}) {
  const [consented, setConsented] = useState(initialConsent);
  const [safety, setSafety] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "starting" });
  const [busy, setBusy] = useState(false);
  const latest = useRef<GeolocationPosition | null>(null);
  const safetyRef = useRef(false);
  const paused = useRef(false);

  useEffect(() => {
    try { setSafety(localStorage.getItem(SAFETY_KEY) === "1"); } catch { /* storage unavailable */ }
  }, []);
  useEffect(() => { safetyRef.current = safety; }, [safety]);

  const send = useCallback(async () => {
    const p = latest.current;
    if (!p || paused.current) return;
    const { data, error } = await supabaseBrowser().rpc("report_location", {
      p_inst: institutionId, p_lat: p.coords.latitude, p_lng: p.coords.longitude,
      p_accuracy: Math.max(1, Math.min(p.coords.accuracy, 5000)), p_safety: safetyRef.current,
    });
    if (error) { setStatus({ kind: "error", message: error.message }); return; }
    const r = data as Report;
    if (r.stored) setStatus({ kind: "sharing", mode: r.mode ?? "campus", campus: r.campus, at: new Date() });
    else if (r.reason === "disabled") setStatus({ kind: "disabled" });
    else setStatus({ kind: "off_campus", at: new Date() });
  }, [institutionId]);

  // Watch the position while consented and this screen is open.
  useEffect(() => {
    if (!consented) return;
    if (!("geolocation" in navigator)) { setStatus({ kind: "error", message: "This device cannot share its location." }); return; }
    paused.current = false;
    let first = true;
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        latest.current = pos;
        if (first) { first = false; void send(); }
      },
      (err) => setStatus({ kind: "error", message: err.code === err.PERMISSION_DENIED
        ? "Location permission is off. Allow location for UniAttend in your phone's settings."
        : "Your location is not available right now. Move outdoors or check that location is on." }),
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 30_000 },
    );
    const timer = setInterval(() => void send(), intervalS * 1000);
    return () => { navigator.geolocation.clearWatch(watch); clearInterval(timer); };
  }, [consented, intervalS, send]);

  async function agree() {
    setBusy(true);
    const { error } = await supabaseBrowser().rpc("set_location_consent", { p_inst: institutionId, p_give: true });
    setBusy(false);
    if (error) setStatus({ kind: "error", message: error.message });
    else { setStatus({ kind: "starting" }); setConsented(true); }
  }

  async function withdraw() {
    setBusy(true);
    const { error } = await supabaseBrowser().rpc("set_location_consent", { p_inst: institutionId, p_give: false });
    setBusy(false);
    if (error) setStatus({ kind: "error", message: error.message });
    else setConsented(false);
  }

  async function pause() {
    paused.current = true;
    await supabaseBrowser().rpc("stop_location_sharing", { p_inst: institutionId });
    setStatus({ kind: "paused" });
  }

  function toggleSafety(on: boolean) {
    setSafety(on);
    safetyRef.current = on;
    try { localStorage.setItem(SAFETY_KEY, on ? "1" : "0"); } catch { /* storage unavailable */ }
    void send();
  }

  if (!consented) {
    return (
      <Card className="space-y-4">
        <CardTitle>Before you turn this on</CardTitle>
        <ul className="list-disc space-y-2 pl-5 text-sm">
          <li><b>What:</b> your phone&apos;s location, about every {intervalS < 60 ? `${intervalS} seconds` : `${Math.round(intervalS / 60)} minute${intervalS >= 120 ? "s" : ""}`} while UniAttend is open.</li>
          <li><b>When:</b> only while you are on campus. It switches off by itself when you leave.</li>
          <li><b>Who sees it:</b> administrators of {institutionName} on a live campus map, for campus safety. Lecturers and other students cannot see it.</li>
          <li><b>How long:</b> only your latest position is kept. It is deleted when you leave campus, pause, or withdraw. Nothing is kept as a history.</li>
          <li><b>Off campus:</b> nothing is shared unless you choose &ldquo;safety sharing&rdquo; yourself.</li>
          <li>You can withdraw at any time on this page. Saying no does not affect your attendance.</li>
        </ul>
        {status.kind === "error" && <Notice tone="bad">{status.message}</Notice>}
        <Button className="w-full" onClick={agree} disabled={busy}>I agree, share my location on campus</Button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3" aria-live="polite">
        <CardTitle>Status</CardTitle>
        {status.kind === "starting" && <Notice>Finding your location… keep this screen open.</Notice>}
        {status.kind === "sharing" && (
          <Notice tone={status.mode === "safety" ? "warn" : "ok"}>
            {status.mode === "safety"
              ? <>Safety sharing is on. Your administrators can see your location while you are off campus.</>
              : <>Sharing on <b>{status.campus ?? "campus"}</b>. Updated {status.at.toLocaleTimeString("en-ZA", { timeStyle: "short" })}.</>}
          </Notice>
        )}
        {status.kind === "off_campus" && <Notice>You are off campus, so nothing is being shared. It starts again by itself when you are back on campus.</Notice>}
        {status.kind === "paused" && <Notice>Paused. Your position was removed. Reopen this page to share again.</Notice>}
        {status.kind === "disabled" && <Notice tone="warn">Your institution has turned location sharing off.</Notice>}
        {status.kind === "error" && <Notice tone="bad">{status.message}</Notice>}
        <p className="text-xs text-muted">Sharing works while UniAttend is open on your phone. Background sharing with the app closed is coming in the Android app update.</p>
      </Card>

      <Card>
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1 size-4" checked={safety} onChange={(e) => toggleSafety(e.target.checked)} />
          <span>
            <span className="block text-sm font-medium">Safety sharing off campus</span>
            <span className="text-xs text-muted">Keep sharing with your administrators when you leave campus, e.g. walking home at night. Turn it off any time.</span>
          </span>
        </label>
      </Card>

      <div className="flex flex-wrap gap-2">
        {status.kind !== "paused" && <Button variant="secondary" onClick={pause}>Pause and remove my position</Button>}
        <Button variant="ghost" onClick={withdraw} disabled={busy}>Withdraw consent</Button>
      </div>
    </div>
  );
}
