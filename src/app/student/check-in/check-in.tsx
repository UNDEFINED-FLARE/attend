"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, Input, Notice } from "@/components/ui";
import { VenueMap } from "@/components/map/venue-map";
import { distanceM, insidePolygon, type LatLng } from "@/lib/campuses";
import { collectGps, deviceHash, parseScan, type GpsSample } from "@/lib/evidence";
import { checkIn, type Verdict } from "../actions";

type Phase = "idle" | "scanning" | "locating" | "sending" | "done";

const HEADLINE: Record<string, [string, string]> = {
  accepted: ["You're checked in", "bg-ok"],
  review: ["Sent for review", "bg-warn"],
  duplicate: ["Already recorded", "bg-info"],
  rejected: ["Not recorded", "bg-bad"],
};

export function CheckIn({ initialSession, initialToken }: { initialSession: string | null; initialToken: string | null }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [code, setCode] = useState("");
  const [result, setResult] = useState<Verdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fix, setFix] = useState<{ center: LatLng; accuracy: number } | null>(null);
  const scanner = useRef<{ stop: () => Promise<void> } | null>(null);
  const started = useRef(false);

  const submit = useCallback(async (scan: { session: string | null; token: string | null; code: string | null }) => {
    setError(null);
    setResult(null);
    setPhase("locating");
    // Location and device hash in parallel; the token is only ~20–40 s fresh.
    const [samples, device] = await Promise.all([collectGps(), deviceHash()]);
    setFix(samples ? meanFix(samples) : null);
    setPhase("sending");
    const r = await checkIn({ ...scan, gps: samples ? { samples } : null, device });
    if ("error" in r) { setError(r.error); setPhase("idle"); return; }
    setResult(r);
    setPhase("done");
  }, []);

  // Opened from the QR's own link (phone camera app): check in straight away.
  useEffect(() => {
    if (!started.current && initialSession && initialToken) {
      started.current = true;
      void submit({ session: initialSession, token: initialToken, code: null });
    }
  }, [initialSession, initialToken, submit]);

  useEffect(() => () => { void scanner.current?.stop().catch(() => {}); }, []);

  async function startScan() {
    setError(null);
    setPhase("scanning");
    const { Html5Qrcode } = await import("html5-qrcode");
    const qr = new Html5Qrcode("qr-reader", { verbose: false });
    scanner.current = { stop: () => qr.stop() };
    try {
      await qr.start({ facingMode: "environment" }, { fps: 10, qrbox: 240 }, async (text) => {
        await qr.stop().catch(() => {});
        scanner.current = null;
        const parsed = parseScan(text);
        if (!parsed.session && !parsed.code) { setError("That QR code is not a UniAttend code."); setPhase("idle"); return; }
        void submit(parsed);
      }, () => {});
    } catch {
      setError("The camera could not start. Allow camera access, or type the code shown under the QR.");
      setPhase("idle");
    }
  }

  const busy = phase === "locating" || phase === "sending";

  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl font-semibold">Check in</h1>

      {result && (
        <Card className="overflow-hidden p-0" aria-live="polite">
          <div className={`${HEADLINE[result.outcome][1]} px-5 py-4 text-white`}>
            <p className="text-lg font-semibold">{HEADLINE[result.outcome][0]}</p>
            {result.module_code && <p className="text-sm opacity-90">{result.module_code} · {result.session_title}</p>}
          </div>
          <div className="space-y-3 p-5 text-sm">
            {result.status && <p>Recorded as <b>{result.status.replace("_", " ")}</b>{result.score != null && <> · confidence {result.score}/100</>}</p>}
            {result.outcome === "review" && <p>Your lecturer will confirm this. It does not count against you while it is pending.</p>}
            {result.venue && (result.venue.polygon || result.venue.lat != null) && (
              <VenueMap venue={result.venue} height={220} me={fix ? { ...fix, inside: isInside(fix, result.venue) } : null} />
            )}
            {result.reasons.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-muted">{result.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
            )}
            <Link href="/student" className="inline-block text-info hover:underline">Back to my attendance</Link>
          </div>
        </Card>
      )}

      {error && <Notice tone="bad">{error}</Notice>}
      {busy && (
        <Notice>{phase === "locating" ? "Checking your location… keep this screen open." : "Recording your attendance…"}</Notice>
      )}

      {phase !== "done" && (
        <Card className="space-y-4">
          <div id="qr-reader" className={phase === "scanning" ? "overflow-hidden rounded-lg" : "hidden"} />
          {phase !== "scanning" ? (
            <Button className="h-14 w-full text-base" onClick={startScan} disabled={busy}>Scan QR code</Button>
          ) : (
            <Button variant="secondary" className="w-full" onClick={() => { void scanner.current?.stop(); setPhase("idle"); }}>Cancel</Button>
          )}
          <div className="flex items-center gap-3 text-xs text-muted"><span className="h-px flex-1 bg-line" />or type the code<span className="h-px flex-1 bg-line" /></div>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void submit({ session: null, token: null, code }); }}>
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} placeholder="ABC234"
              className="h-12 text-center font-mono text-lg tracking-[0.3em]" aria-label="Session code" autoCapitalize="characters" />
            <Button type="submit" className="h-12" disabled={busy || code.length !== 6}>Go</Button>
          </form>
          <p className="text-xs text-muted">Your location is checked once against the venue and not stored. Scanning the live QR gives the strongest proof; a typed code may be sent for review.</p>
        </Card>
      )}
      {phase === "done" && <Button variant="secondary" className="w-full" onClick={() => { setPhase("idle"); setResult(null); }}>Check in to another session</Button>}
    </div>
  );
}

function meanFix(s: GpsSample[]): { center: LatLng; accuracy: number } {
  const w = s.map((x) => 1 / Math.max(9, x.accuracy ** 2));
  const W = w.reduce((a, b) => a + b, 0);
  return {
    center: [s.reduce((a, x, i) => a + x.lat * w[i], 0) / W, s.reduce((a, x, i) => a + x.lng * w[i], 0) / W],
    accuracy: Math.min(...s.map((x) => x.accuracy)),
  };
}

function isInside(fix: { center: LatLng }, v: NonNullable<Verdict["venue"]>): boolean {
  if (v.polygon && v.polygon.length >= 3) return insidePolygon(fix.center, v.polygon);
  return v.lat != null && v.lng != null && distanceM(fix.center, [v.lat, v.lng]) <= (v.radius_m ?? 60);
}
