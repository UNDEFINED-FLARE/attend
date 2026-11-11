import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { Scanner } from "./scanner";

export const metadata = { title: "Scan student cards" };

export default async function ScanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireRole("lecturer");
  const { data: s } = await supabase.from("class_sessions").select("id, title, status, modules(code)").eq("id", id).maybeSingle();
  if (!s) notFound();
  const mod = s.modules as unknown as { code: string };
  return (
    <div className="mx-auto max-w-xl">
      <Link href={`/lecturer/sessions/${id}`} className="text-sm text-info hover:underline">← {mod.code} · {s.title}</Link>
      <h1 className="mb-1 mt-2 text-[28px] font-bold tracking-tight">Scan student cards</h1>
      <p className="mb-5 text-sm text-muted">Scan the barcode or QR on a student card. Students are matched by student number and must be enrolled in {mod.code}.
        {s.status !== "open" && " Check-in is closed or paused, so only check-outs are recorded."}</p>
      <Scanner session={id} />
    </div>
  );
}
