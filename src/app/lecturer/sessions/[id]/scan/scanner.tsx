"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { scanStudent, type ScanResult } from "../../../actions";

type Logged = ScanResult & { at: Date; code: string };

const GOOD = new Set(["checked_in", "checked_out"]);
const COOLDOWN_MS = 4000; // the same card read twice in a row by the camera is one scan

/** Beep: high for success, low for a problem. Silent if audio is blocked. */
function beep(ok: boolean) {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = ok ? 880 : 220; g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + (ok ? 0.12 : 0.3));
    navigator.vibrate?.(ok ? 60 : [80, 60, 80]);
  } catch { /* no audio */ }
}

/**
 * Scan station: the camera reads barcodes and QR codes from student cards, and a USB
 * scanner works like a keyboard (it types the number and presses Enter) into the box.
 */
export function Scanner({ session }: { session: string }) {
  const [dir, setDir] = useState<"in" | "out">("in");
  const [log, setLog] = useState<Logged[]>([]);
  const [code, setCode] = useState("");
  const [camera, setCamera] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const last = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const busy = useRef(false);
  const dirRef = useRef(dir);
  useEffect(() => { dirRef.current = dir; }, [dir]);

  const submit = useCallback(async (raw: string) => {
    const c = raw.trim();
    if (!c || busy.current) return;
    if (c === last.current.code && Date.now() - last.current.at < COOLDOWN_MS) return;
    last.current = { code: c, at: Date.now() };
    busy.current = true;
    let r: ScanResult;
    try {
      r = await scanStudent(session, c, dirRef.current);
    } catch {
      r = { outcome: "error", message: "Couldn't reach the server. Check the connection and scan again." };
      last.current = { code: "", at: 0 }; // allow an immediate retry of the same card
    } finally {
      busy.current = false;
    }
    beep(GOOD.has(r.outcome));
    setLog((l) => [{ ...r, at: new Date(), code: c }, ...l].slice(0, 50));
    setCode("");
    input.current?.focus();
  }, [session]);

  // Camera scanning with barcode formats used on student cards.
  useEffect(() => {
    if (!camera) return;
    let stop: (() => Promise<void>) | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats: F } = await import("html5-qrcode");
        if (cancelled) return;
        const qr = new Html5Qrcode("card-reader", {
          verbose: false,
          formatsToSupport: [F.QR_CODE, F.CODE_128, F.CODE_39, F.CODE_93, F.EAN_13, F.EAN_8, F.ITF, F.CODABAR, F.DATA_MATRIX, F.PDF_417],
        });
        await qr.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 280, height: 160 } }, (text) => void submit(text), () => {});
        stop = () => qr.stop();
      } catch {
        setCamError("The camera could not start. Allow camera access, or use a USB scanner or type the number.");
        setCamera(false);
      }
    })();
    return () => { cancelled = true; void stop?.().catch(() => {}); };
  }, [camera, submit]);

  const tone = (o: string) => (GOOD.has(o) ? "border-ok/40 bg-ok/5" : o === "duplicate" ? "border-line bg-bg" : "border-bad/40 bg-bad/5");
  const title = (r: Logged) => {
    if (r.outcome === "checked_in") return `${r.full_name} · ${r.status === "late" ? `late${r.minutes_late ? ` (${r.minutes_late} min)` : ""}` : "present"}`;
    if (r.outcome === "checked_out") return `${r.full_name} · out${r.minutes_present != null ? ` after ${r.minutes_present} min` : ""}${r.left_early ? " · left early" : ""}`;
    if (r.outcome === "duplicate") return `${r.full_name ?? r.code} · already recorded`;
    return r.message ?? "Not recorded";
  };
  const ok = log.filter((l) => GOOD.has(l.outcome)).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-surface p-1.5 shadow-card" role="radiogroup" aria-label="Direction">
        {(["in", "out"] as const).map((d) => (
          <button key={d} type="button" role="radio" aria-checked={dir === d} onClick={() => setDir(d)}
            className={`h-12 rounded-xl text-sm font-bold transition ${dir === d ? (d === "in" ? "bg-ok text-white" : "bg-ink text-surface") : "text-muted"}`}>
            {d === "in" ? "Check in" : "Check out"}
          </button>
        ))}
      </div>

      <section className="rounded-[28px] bg-surface p-4 shadow-card">
        <div className={`scan-frame relative mx-auto aspect-[7/4] w-full max-w-md overflow-hidden rounded-3xl bg-bg ${camera ? "" : "grid place-items-center"}`}>
          <span className="scan-corners" aria-hidden />
          {camera && <span className="scan-line" aria-hidden />}
          <div id="card-reader" className={camera ? "size-full [&_video]:!size-full [&_video]:object-cover" : "hidden"} />
          {!camera && (
            <button type="button" onClick={() => { setCamError(null); setCamera(true); }} className="flex flex-col items-center gap-2 text-muted">
              <Icon name="scan" size={44} strokeWidth={1.4} /><span className="text-sm font-semibold">Tap to use the camera</span>
            </button>
          )}
        </div>
        {camera && <button type="button" onClick={() => setCamera(false)} className="mt-3 h-10 w-full rounded-xl bg-bg text-sm font-semibold">Stop camera</button>}
        {camError && <p className="mt-3 text-sm text-bad">{camError}</p>}

        <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); void submit(code); }}>
          <input ref={input} value={code} onChange={(e) => setCode(e.target.value)} autoFocus inputMode="text" autoComplete="off" spellCheck={false}
            placeholder="USB scanner or type a student number" aria-label="Student number"
            className="h-12 flex-1 rounded-2xl border border-line bg-bg px-4 font-mono text-base" />
          <button type="submit" className="h-12 rounded-2xl bg-accent px-5 font-semibold text-white">Go</button>
        </form>
        <p className="mt-2 text-xs text-muted">A USB barcode scanner types into this box and presses Enter by itself; keep the box selected.</p>
      </section>

      <section className="rounded-[28px] bg-surface p-4 shadow-card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold">This session</h2>
          <span className="text-xs font-semibold text-muted">{ok} recorded here</span>
        </div>
        {log.length === 0 && <p className="py-6 text-center text-sm text-muted">Scans appear here.</p>}
        <ul className="space-y-2" aria-live="polite">
          {log.map((r, i) => (
            <li key={`${r.at.getTime()}-${i}`} className={`flex items-center gap-3 rounded-2xl border p-3 ${tone(r.outcome)}`}>
              <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${GOOD.has(r.outcome) ? "bg-ok text-white" : r.outcome === "duplicate" ? "bg-line text-muted" : "bg-bad text-white"}`}>
                <Icon name={GOOD.has(r.outcome) ? "check" : r.outcome === "duplicate" ? "clock" : "x"} size={18} strokeWidth={2.6} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{title(r)}</span>
                <span className="block text-xs text-muted">{r.student_number ?? r.code} · {r.at.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
