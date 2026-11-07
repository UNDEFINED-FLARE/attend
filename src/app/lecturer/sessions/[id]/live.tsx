"use client";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { qrToken } from "../../actions";

/**
 * Re-fetches a freshly signed token at each 20-second step boundary. The QR
 * encodes a check-in link, so a student's ordinary camera app works too.
 */
export function LiveQr({ session }: { session: string }) {
  const [img, setImg] = useState<string | null>(null);
  const [code, setCode] = useState<string>("");
  const [closed, setClosed] = useState(false);
  const [big, setBig] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let alive = true;
    const tick = async () => {
      const t = await qrToken(session);
      if (!alive) return;
      if (!t.open || !t.token) { setClosed(true); return; }
      const url = `${window.location.origin}/student/check-in?s=${session}&t=${encodeURIComponent(t.token)}`;
      setImg(await QRCode.toDataURL(url, { width: 640, margin: 1, errorCorrectionLevel: "M", color: { dark: "#0b2545" } }));
      setCode(t.join_code ?? "");
      timer = setTimeout(tick, Math.max(1000, t.refresh_in_ms ?? 20000) + 150);
    };
    void tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [session]);

  if (closed) return <Card><p className="text-sm text-muted">This session is no longer accepting check-ins.</p></Card>;

  const qr = (
    <div className="text-center">
      {/* eslint-disable-next-line @next/next/no-img-element -- a local data: URL, nothing to optimise */}
      {img ? <img src={img} alt="Attendance QR code, refreshes every 20 seconds" className="mx-auto aspect-square w-full max-w-[560px] rounded-lg" />
           : <div className="mx-auto aspect-square w-full max-w-[560px] animate-pulse rounded-lg bg-bg" />}
      <p className="mt-3 font-mono text-4xl font-semibold tracking-[0.3em]">{code}</p>
      <p className="text-xs text-muted">Scan, or type the code at /student/check-in · refreshes every 20 s</p>
    </div>
  );

  return (
    <>
      <Card>
        {qr}
        <button onClick={() => setBig(true)} className="mt-3 w-full rounded-lg border border-line py-2 text-sm hover:bg-bg">Show full screen for projector</button>
      </Card>
      {big && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-white p-6" onClick={() => setBig(false)}>
          <div className="w-full max-w-[80vh]">{qr}<p className="mt-4 text-center text-sm text-muted">Tap anywhere to close</p></div>
        </div>
      )}
    </>
  );
}

/** Refreshes the server-rendered register whenever a record for this session changes. */
export function RealtimeRefresh({ session }: { session: string }) {
  const router = useRouter();
  useEffect(() => {
    const sb = supabaseBrowser();
    let pending: ReturnType<typeof setTimeout> | null = null;
    const ch = sb.channel(`session-${session}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance_records", filter: `session_id=eq.${session}` }, () => {
        pending ??= setTimeout(() => { pending = null; router.refresh(); }, 800);
      })
      .subscribe();
    // Realtime can drop on poor campus Wi-Fi; a slow poll keeps the register honest.
    const poll = setInterval(() => router.refresh(), 15000);
    return () => { void sb.removeChannel(ch); clearInterval(poll); if (pending) clearTimeout(pending); };
  }, [session, router]);
  return null;
}
