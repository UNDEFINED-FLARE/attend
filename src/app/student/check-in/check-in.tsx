"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Input, Notice } from "@/components/ui";
import { Icon } from "@/components/icons";
import { ArrivalTimeline, LateChip } from "@/components/late";
import { VenueMap } from "@/components/map/venue-map";
import { distanceM, insidePolygon, type LatLng } from "@/lib/campuses";
import { collectGps, deviceHash, parseScan, type GpsSample } from "@/lib/evidence";
import { enqueue, isNetworkError } from "@/lib/offline-queue";
import { checkIn, type Verdict } from "../actions";

type Phase = "idle" | "scanning" | "locating" | "sending" | "done";

const HEADLINE: Record<string, [string, string]> = {
  accepted: ["You're checked in", "bg-ok"],
  review: ["Sent for review", "bg-warn"],
  duplicate: ["Already recorded", "bg-info"],
  queued: ["Saved on this phone", "bg-info"],
  rejected: ["Not recorded", "bg-bad"],
};

export function CheckIn({ userId, initialSession, initialToken, liveClass = true }: { userId: string; initialSession: string | null; initialToken: string | null; liveClass?: boolean }) {
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
    // The moment of the scan: kept if this has to wait for signal.
    const captured_at = new Date().toISOString();
    // Location and device hash in parallel; the token is only ~20–40 s fresh.
    const [samples, device] = await Promise.all([collectGps(), deviceHash()]);
    setFix(samples ? meanFix(samples) : null);
    setPhase("sending");
    const evidence = { ...scan, gps: samples ? { samples } : null, device };
    // No signal: keep the evidence on the phone; it is sent for review when back online.
    const save = () => {
      enqueue({ userId, kind: "checkin", payload: { ...evidence, captured_at } });
      const at = new Date(captured_at).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
      setResult({ outcome: "queued", status: null, score: null, reasons: [
        `No signal, so your check-in was saved on this phone at ${at}${samples ? ", with your location" : ""}.`,
        "It will be sent automatically as soon as you're back online. Keep UniAttend installed and sign in as yourself.",
        "Because it was made offline, your lecturer confirms it. It keeps the time you scanned, not the time it is sent.",
      ] });
      setPhase("done");
    };
    if (typeof navigator !== "undefined" && !navigator.onLine) { save(); return; }
    let r: Awaited<ReturnType<typeof checkIn>>;
    try { r = await checkIn(evidence); }
    catch (e) {
      if (isNetworkError(e)) { save(); return; }
      setError("Something went wrong. Try again."); setPhase("idle"); return;
    }
    if ("error" in r) { setError(r.error); setPhase("idle"); return; }
    setResult(r);
    setPhase("done");
  }, [userId]);

  // Opened from the QR's own link (phone camera app): check in straight away.
  // (Offline, the page is the saved copy without them, so read them from the address too.)
  useEffect(() => {
    if (started.current) return;
    const q = new URLSearchParams(window.location.search);
    const session = initialSession ?? q.get("s"), token = initialToken ?? q.get("t");
    if (session && token && /^[0-9a-f-]{36}$/i.test(session)) {
      started.current = true;
      void submit({ session, token, code: null });
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
  const late = result?.status === "late_pending";
  const router = useRouter();
  const liveUrl = liveClass && result?.session_id && result.outcome !== "rejected" ? `/student/class/${result.session_id}` : null;
  // After a successful check-in, go to the live class screen.
  useEffect(() => {
    if (!liveUrl || result?.outcome !== "accepted") return;
    const t = setTimeout(() => router.push(liveUrl), 2500);
    return () => clearTimeout(t);
  }, [liveUrl, result?.outcome, router]);

  // First visit: explain the camera and location before asking for them.
  const [intro, setIntro] = useState(false);
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    try { if (!initialSession && !localStorage.getItem("ua_checkin_intro")) setIntro(true); } catch { /* storage blocked: skip the intro */ }
  }, [initialSession]);
  const startFromIntro = () => { try { localStorage.setItem("ua_checkin_intro", "1"); } catch { /* ignore */ } setIntro(false); };

  if (intro) {
    return (
      <div className="mx-auto flex min-h-[calc(100dvh-11rem)] max-w-md flex-col rounded-[32px] bg-surface px-6 pb-6 pt-10 text-center shadow-card lg:min-h-0">
        <div className="relative mx-auto mt-6 grid size-56 place-items-center">
          <span aria-hidden className="absolute inset-0 rounded-[46%_54%_42%_58%/55%_45%_55%_45%] bg-accent/12" />
          <span aria-hidden className="absolute inset-6 rounded-[58%_42%_50%_50%/45%_55%_45%_55%] bg-accent/10" />
          <span className="relative grid size-24 place-items-center rounded-3xl bg-surface text-accent shadow-card"><Icon name="scan" size={52} strokeWidth={1.6} /></span>
        </div>
        <h1 className="mt-10 text-2xl font-bold tracking-tight">Welcome to check-in</h1>
        <p className="mx-auto mt-3 max-w-xs text-sm leading-relaxed text-muted">
          Allow your <b className="text-ink">camera</b> so you can scan the code on the projector, and your <b className="text-ink">location</b> so we can confirm you&apos;re in the venue. Your location is checked once and not stored.
        </p>
        <div className="mt-6 flex justify-center gap-1.5" aria-hidden><i className="size-1.5 rounded-full bg-line" /><i className="h-1.5 w-5 rounded-full bg-accent" /><i className="size-1.5 rounded-full bg-line" /></div>
        <button type="button" onClick={startFromIntro} className="mt-auto h-14 w-full rounded-2xl bg-accent text-base font-semibold text-white shadow-[0_10px_24px_color-mix(in_srgb,var(--accent)_35%,transparent)] transition active:scale-[0.98] lg:mt-10">
          Let&apos;s get started
        </button>
      </div>
    );
  }

  const status = phase === "scanning" ? "Scanning code…" : phase === "locating" ? "Checking your location…" : phase === "sending" ? "Recording your attendance…" : "Ready when you are";

  return (
    <div className="relative mx-auto max-w-md">
      {/* The brand band behind the sheet, edge to edge on phones. */}
      <div aria-hidden className="absolute -inset-x-4 -top-[max(20px,env(safe-area-inset-top))] h-44 rounded-b-[40px] bg-gradient-to-br from-brand to-accent lg:hidden" />
      <div className="relative space-y-4 pt-10 lg:pt-0">
        {result && (
          <section className="overflow-hidden rounded-[28px] bg-surface shadow-card" aria-live="polite">
            <div className={`${late ? "bg-muted" : HEADLINE[result.outcome][1]} px-5 py-5 text-white`}>
              <div className="flex items-start justify-between gap-3">
                <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-white/20">
                  <Icon name={late ? "clock" : result.outcome === "accepted" ? "check" : result.outcome === "rejected" ? "x" : "alert"} size={26} strokeWidth={2.4} />
                </span>
                {result.minutes_late != null && <span className="shrink-0 rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold">{result.minutes_late} min late</span>}
              </div>
              <p className="mt-3 text-xl font-bold">{late ? "You're in — arrived late" : HEADLINE[result.outcome][0]}</p>
              {result.module_code && <p className="text-sm opacity-90">{result.module_code} · {result.session_title}</p>}
            </div>
            <div className="space-y-3 p-5 text-sm">
              {late && result.opens_at && result.late_after && result.checked_in_at && (
                <ArrivalTimeline opensAt={result.opens_at} lateAfter={result.late_after} arrivedAt={result.checked_in_at} />
              )}
              {late && (
                <div className="rounded-2xl bg-bg p-3">
                  <p className="font-semibold">Waiting for your lecturer</p>
                  <p className="mt-0.5 text-muted">Your lecturer decides whether this late arrival counts. If they don&apos;t deny it, it counts as attended (late) when the class closes. You&apos;ll get a notification either way.</p>
                </div>
              )}
              {result.status && !late && <p>Recorded as <b>{result.status.replace("_", " ")}</b>{result.minutes_late != null && <> <LateChip minutes={result.minutes_late} /></>}{result.score != null && <> · confidence {result.score}/100</>}</p>}
              {result.outcome === "review" && <p className="text-muted">Your lecturer will confirm this. It does not count against you while it is pending.</p>}
              {result.outcome === "queued" && <p className="flex items-center gap-2 font-semibold"><Icon name="clock" size={18} />Waiting for signal</p>}
              {result.venue && (result.venue.polygon || result.venue.lat != null) && (
                <div className="overflow-hidden rounded-2xl"><VenueMap venue={result.venue} height={200} me={fix ? { ...fix, inside: isInside(fix, result.venue) } : null} /></div>
              )}
              {result.reasons.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-muted">{result.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
              )}
              {liveUrl && (
                <Link href={liveUrl} className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-accent font-semibold text-white">
                  <span className="size-2 animate-pulse rounded-full bg-white" />Open live class{result.outcome === "accepted" ? " …" : ""}
                </Link>
              )}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Link href="/student" className="grid h-12 place-items-center rounded-2xl bg-bg font-semibold">Dashboard</Link>
                <button type="button" onClick={() => { setPhase("idle"); setResult(null); }} className="h-12 rounded-2xl bg-accent font-semibold text-white">Scan again</button>
              </div>
            </div>
          </section>
        )}

        {phase !== "done" && (
          <section className="rounded-[32px] bg-surface px-5 pb-6 pt-3 shadow-[0_-4px_30px_rgb(15_27_45/0.08)]">
            <div className="mx-auto h-1.5 w-12 rounded-full bg-line" aria-hidden />
            <div className="mt-3 flex justify-end">
              <Link href="/student/history" aria-label="Attendance history" className="grid size-10 place-items-center rounded-xl border-2 border-accent/30 text-accent"><Icon name="history" size={18} /></Link>
            </div>
            <h1 className="-mt-4 text-center text-xl font-bold">Scan QR code</h1>
            <p className="mx-auto mt-2 max-w-64 text-center text-sm leading-relaxed text-muted">Place the code on the projector inside the frame and hold steady for a quick scan.</p>

            <div className="scan-frame relative mx-auto mt-7 aspect-square w-full max-w-64 rounded-3xl">
              <span className="scan-corners" aria-hidden />
              {(phase === "scanning" || busy) && <span className="scan-line" aria-hidden />}
              <div id="qr-reader" className={phase === "scanning" ? "size-full overflow-hidden rounded-3xl [&_video]:!size-full [&_video]:object-cover" : "hidden"} />
              {phase !== "scanning" && (
                <button type="button" onClick={startScan} disabled={busy} aria-label="Open the camera"
                  className="grid size-full place-items-center rounded-3xl p-10 text-ink transition disabled:opacity-60">
                  <QrArt />
                </button>
              )}
            </div>
            <p className={`mt-5 text-center text-sm font-medium ${busy || phase === "scanning" ? "text-accent" : "text-muted"}`} aria-live="polite">{status}</p>

            <div className="mt-5 flex items-center justify-center gap-8 text-muted">
              <button type="button" onClick={() => setTyping((t) => !t)} aria-pressed={typing} className={`flex flex-col items-center gap-1 text-[11px] font-semibold ${typing ? "text-accent" : ""}`}><Icon name="file" size={22} />Type code</button>
              <Link href="/student/map" className="flex flex-col items-center gap-1 text-[11px] font-semibold"><Icon name="map" size={22} />Venue map</Link>
              <Link href="/privacy" className="flex flex-col items-center gap-1 text-[11px] font-semibold"><Icon name="shield" size={22} />Privacy</Link>
            </div>

            {typing && (
              <form className="mt-5 flex gap-2" onSubmit={(e) => { e.preventDefault(); void submit({ session: null, token: null, code }); }}>
                <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} placeholder="ABC234" autoFocus
                  className="h-14 flex-1 rounded-2xl text-center font-mono text-xl tracking-[0.35em]" aria-label="Session code" autoCapitalize="characters" />
                <Button type="submit" className="h-14 rounded-2xl px-6" disabled={busy || code.length !== 6}>Go</Button>
              </form>
            )}

            {error && <div className="mt-4"><Notice tone="bad">{error}</Notice></div>}

            {phase !== "scanning" ? (
              <button type="button" onClick={startScan} disabled={busy}
                className="mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-accent text-base font-semibold text-white shadow-[0_10px_24px_color-mix(in_srgb,var(--accent)_35%,transparent)] transition active:scale-[0.98] disabled:opacity-60">
                <Icon name="scan" size={20} />{busy ? "Working…" : "Scan QR code"}
              </button>
            ) : (
              <button type="button" onClick={() => { void scanner.current?.stop(); setPhase("idle"); }}
                className="mt-6 h-14 w-full rounded-2xl bg-bg text-base font-semibold">Cancel</button>
            )}
            <p className="mt-4 text-center text-xs text-muted">The live QR gives the strongest proof; a typed code may be sent for review.</p>
          </section>
        )}
      </div>
    </div>
  );
}

/** A stylised QR code for the idle frame. */
function QrArt() {
  const finder = (x: number, y: number) => (
    <g key={`${x}-${y}`}>
      <rect x={x} y={y} width="28" height="28" rx="8" fill="none" stroke="currentColor" strokeWidth="6" />
      <rect x={x + 9} y={y + 9} width="10" height="10" rx="3" fill="currentColor" />
    </g>
  );
  const dots = [[44, 6], [56, 6], [44, 20], [6, 46], [20, 46], [34, 46], [48, 40], [62, 48], [76, 46], [90, 46], [48, 56], [62, 64], [76, 60], [90, 70], [48, 72], [62, 82], [76, 78], [90, 90], [48, 90], [76, 94]];
  return (
    <svg viewBox="0 0 100 100" className="size-full opacity-85" aria-hidden>
      {finder(4, 4)}{finder(68, 4)}{finder(4, 68)}
      {dots.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="9" height="9" rx="3" fill="currentColor" />)}
    </svg>
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
