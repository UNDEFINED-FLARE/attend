import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { LiveClass } from "./live-class";

export const metadata = { title: "In class" };

/** The student's live view of one class, from check-in until the class ends or the lecturer closes it. */
export default async function ClassPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, institutionId, user } = await requireRole("student");
  const { data: s } = await supabase.from("class_sessions")
    .select("id, title, status, opens_at, closes_at, late_after, modules(code, title), venues(name)").eq("id", id).maybeSingle();
  if (!s) notFound();
  const { data: me } = await supabase.from("students").select("id").eq("institution_id", institutionId).eq("user_id", user.id).maybeSingle();
  const recSelect = (full: boolean) => supabase.from("attendance_records")
    .select(`id, status, checked_in_at${full ? ", minutes_late, checked_out_at, attendance_statuses(name, color)" : ""}`)
    .eq("session_id", id).eq("student_id", me?.id ?? "00000000-0000-0000-0000-000000000000").maybeSingle();
  let rec = await recSelect(true);
  if (rec.error) rec = await recSelect(false);
  const r = rec.data as unknown as { id: string; status: string; checked_in_at: string | null; minutes_late?: number | null;
    checked_out_at?: string | null; attendance_statuses?: { name: string; color: string } | null } | null;
  const mod = s.modules as unknown as { code: string; title: string };

  if (!r) {
    return (
      <div className="mx-auto max-w-md space-y-4 pt-6 text-center">
        <h1 className="text-2xl font-bold">{mod.code} · {s.title}</h1>
        <p className="text-sm text-muted">You haven&apos;t checked in to this class.</p>
        {s.status === "open" && <Link href="/student/check-in" className="inline-flex h-12 items-center rounded-2xl bg-accent px-6 font-semibold text-white">Check in</Link>}
      </div>
    );
  }
  return (
    <LiveClass
      session={{ id: s.id, title: s.title, status: s.status, opens_at: s.opens_at, closes_at: s.closes_at, code: mod.code, module: mod.title,
        venue: (s.venues as unknown as { name: string } | null)?.name ?? null }}
      record={{ id: r.id, status: r.status, checked_in_at: r.checked_in_at, minutes_late: r.minutes_late ?? null,
        checked_out_at: r.checked_out_at ?? null, custom: r.attendance_statuses ?? null }} />
  );
}
