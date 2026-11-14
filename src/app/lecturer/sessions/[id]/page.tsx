import { loadTheme } from "@/lib/shell-data";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Submit } from "@/components/form";
import { Badge, Card, PageHeader, Stat, when } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { closeSession } from "../../actions";
import { VenueMap } from "@/components/map/venue-map";
import type { LatLng } from "@/lib/campuses";
import { LateArrivals, type LateRow } from "./late-arrivals";
import { LiveQr, RealtimeRefresh } from "./live";
import { Register, type CustomStatus, type RegisterRow } from "./register";
import { SessionControls } from "./controls";

type Rec = { id: string; student_id: string; status: string; custom_status_id?: string | null; checked_out_at?: string | null; minutes_late: number | null; overridden_by: string | null; score: number | null; checked_in_at: string | null;
             explanation: string[]; method: string; override_note: string | null };

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, institutionId, user } = await requireRole("lecturer");
  const features = (await loadTheme(supabase, institutionId)).features;
  // allow_printed_qr needs database update 0016; older databases still load.
  const sessionSelect = (printed: boolean) => supabase.from("class_sessions")
    .select(`id, title, status, join_code, opens_at, closes_at, late_after, require_gps, module_id, modules(code, title), venues(name, lat, lng, radius_m, polygon)${printed ? ", allow_printed_qr" : ""}`)
    .eq("id", id).maybeSingle();
  let sRes = await sessionSelect(true);
  if (sRes.error) sRes = await sessionSelect(false);
  const s = sRes.data as unknown as ({ id: string; title: string; status: string; join_code: string; opens_at: string; closes_at: string; late_after: string;
    require_gps: boolean; module_id: string; modules: unknown; venues: unknown; allow_printed_qr?: boolean }) | null;
  if (!s) notFound();
  const recSelect = (custom: boolean) => supabase.from("attendance_records")
    .select(`id, student_id, status, minutes_late, overridden_by, score, checked_in_at, explanation, method, override_note${custom ? ", custom_status_id, checked_out_at" : ""}`).eq("session_id", id);
  const [{ data: enrolled }, recRes, { data: statusRows }] = await Promise.all([
    supabase.from("module_enrolments").select("students(id, student_number, full_name)").eq("module_id", s.module_id).eq("status", "active"),
    recSelect(true),
    supabase.from("attendance_statuses").select("id, name, color, category").eq("active", true).order("sort_order").order("name"),
  ]);
  // custom_status_id needs database update 0014; older databases still load.
  const recs = (recRes.error ? (await recSelect(false)).data : recRes.data) as unknown as Rec[] | null;
  const byStudent = new Map((recs ?? []).map((r) => [r.student_id, r]));
  const roster = (enrolled ?? []).map((e) => e.students as unknown as { id: string; student_number: string; full_name: string })
    .sort((a, b) => a.student_number.localeCompare(b.student_number));
  const count = (st: string) => (recs ?? []).filter((r) => r.status === st).length;
  const mod = s.modules as unknown as { code: string; title: string };
  const open = s.status === "open";
  const lateRecs = ((recs ?? []) as Rec[]).filter((r) => r.minutes_late != null && ["late_pending", "late", "absent"].includes(r.status));
  const { data: gpsRows } = lateRecs.length
    ? await supabase.from("attendance_evidence").select("record_id, data").eq("kind", "gps").in("record_id", lateRecs.map((r) => r.id))
    : { data: [] };
  const gpsOf = new Map((gpsRows ?? []).map((g) => [g.record_id as string, g.data as LateRow["gps"]]));
  const who = new Map(roster.map((st) => [st.id, st]));
  const lateRows: LateRow[] = lateRecs.flatMap((r) => {
    const st = who.get(r.student_id);
    return st ? [{ student_id: r.student_id, student_number: st.student_number, full_name: st.full_name, status: r.status,
      minutes_late: r.minutes_late!, checked_in_at: r.checked_in_at, score: r.score, gps: gpsOf.get(r.id) ?? null,
      decided_by_close: r.status === "late" && !r.overridden_by }] : [];
  });
  const venue = s.venues as unknown as { name: string; lat: number | null; lng: number | null; radius_m: number | null; polygon: LatLng[] | null } | null;

  return (
    <>
      <RealtimeRefresh session={id} />
      <Link href={`/lecturer/modules/${s.module_id}`} className="text-sm text-info hover:underline">← {mod.code}</Link>
      <PageHeader title={`${mod.code} · ${s.title}`}
        subtitle={<>{venue?.name ?? "No venue"} · opened {when(s.opens_at)} · late after {when(s.late_after)}
          {!s.require_gps && " · location check off"}</>}
        action={open && (
          <form action={closeSession}>
            <input type="hidden" name="session" value={id} />
            <Submit label="Close session" pending="Closing…" variant="danger" />
          </form>
        )} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_1fr]">
        <div className="space-y-4">
          {open ? <LiveQr session={id} /> : s.status === "scheduled"
            ? <Card><p className="text-sm font-semibold text-warn">Check-in is paused.</p><p className="text-xs text-muted">Students can&apos;t check in until you resume it below.</p></Card>
            : <Card><Badge status={s.status} /> <span className="ml-2 text-sm text-muted">This session is {s.status}.</span></Card>}
          {(open || s.status === "scheduled") && (
            <SessionControls session={id} status={s.status} requireGps={s.require_gps} printed={!!s.allow_printed_qr} closesAt={s.closes_at} lateAfter={s.late_after}
              printedFeature={features.printedQr} scanFeature={features.cardScanning} />
          )}
          {venue && (venue.polygon || venue.lat != null) && <VenueMap venue={venue} height={220} />}
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Present" value={count("present")} />
            <Stat label="Late" value={count("late") + count("late_pending")} hint={count("late_pending") ? `${count("late_pending")} awaiting you` : undefined} />
            <Stat label="To review" value={count("pending_verification")} />
            <Stat label={open ? "Not yet in" : "Absent"} value={open ? roster.length - (recs ?? []).length : count("absent")} />
          </div>
        </div>

        <div className="min-w-0 space-y-6">
        <LateArrivals session={id} rows={lateRows} />
        <Register session={id} open={open} userId={user.id} label={`${mod.code} · ${s.title}`} statuses={(statusRows ?? []) as CustomStatus[]}
          rows={roster.map((st): RegisterRow => {
            const r = byStudent.get(st.id);
            return { student_id: st.id, student_number: st.student_number, full_name: st.full_name, record_id: r?.id ?? null,
              status: r?.status ?? null, custom_status_id: r?.custom_status_id ?? null, checked_in_at: r?.checked_in_at ?? null,
              method: r?.method ?? null, minutes_late: r?.minutes_late ?? null, checked_out_at: r?.checked_out_at ?? null };
          })} />
        </div>
      </div>
    </>
  );
}
