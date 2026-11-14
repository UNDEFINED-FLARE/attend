import { FeatureOff } from "@/components/feature-off";
import { loadTheme } from "@/lib/shell-data";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { requireRole } from "@/lib/auth";
import { env } from "@/lib/env";
import { PrintButton } from "./print-button";

export const metadata = { title: "Printed QR" };

/** A printable / downloadable fixed QR for one session (only when the location check is on). */
export default async function PrintQr({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, institutionId } = await requireRole("lecturer");
  if (!(await loadTheme(supabase, institutionId)).features.printedQr) return <FeatureOff name="The printed QR code" />;
  const { data: s } = await supabase.from("class_sessions")
    .select("id, title, closes_at, modules(code, title), venues(name)").eq("id", id).maybeSingle();
  if (!s) notFound();
  const { data: token } = await supabase.rpc("printed_qr_token", { p_session: id });
  const mod = s.modules as unknown as { code: string; title: string };
  const venue = (s.venues as unknown as { name: string } | null)?.name;

  if (!token) {
    return (
      <main className="mx-auto max-w-md p-8 text-center">
        <p className="font-semibold">The printed QR is switched off for this session.</p>
        <Link href={`/lecturer/sessions/${id}`} className="mt-3 inline-block text-accent">Back to the session</Link>
      </main>
    );
  }
  const h = await headers();
  const origin = h.get("x-forwarded-host") ? `https://${h.get("x-forwarded-host")}` : env.siteUrl;
  const url = `${origin}/student/check-in?s=${id}&t=${encodeURIComponent(token as string)}`;
  const png = await QRCode.toDataURL(url, { width: 900, margin: 2, errorCorrectionLevel: "M", color: { dark: "#0b2545" } });
  const until = new Date(s.closes_at).toLocaleString("en-ZA", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" });

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center justify-center gap-5 bg-white p-8 text-center text-[#0b2545] print:min-h-0 print:p-0">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] opacity-70">Attendance</p>
        <h1 className="mt-1 text-4xl font-bold">{mod.code}</h1>
        <p className="text-lg">{s.title}{venue ? ` · ${venue}` : ""}</p>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- a generated data: URL */}
      <img src={png} alt={`Check-in QR code for ${mod.code}`} className="aspect-square w-full max-w-md" />
      <div className="space-y-1 text-base">
        <p><b>Scan with your phone camera</b> to check in. Your location is checked, so you must be in the venue.</p>
        <p className="text-sm opacity-70">Valid until {until}.</p>
      </div>
      <div className="flex gap-2 print:hidden">
        <PrintButton />
        <a href={png} download={`${mod.code}-attendance-qr.png`} className="h-11 rounded-xl border border-[#0b2545] px-5 font-semibold leading-[44px]">Download PNG</a>
      </div>
    </main>
  );
}
