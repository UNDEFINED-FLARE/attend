import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, Submit } from "@/components/form";
import { Badge, Card, CardTitle, Field, Input, PageHeader, Select, Stat, Table, Td, when } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { closeSession, override } from "../../actions";
import { VenueMap } from "@/components/map/venue-map";
import type { LatLng } from "@/lib/campuses";
import { LiveQr, RealtimeRefresh } from "./live";

type Rec = { student_id: string; status: string; score: number | null; checked_in_at: string | null;
             explanation: string[]; method: string; override_note: string | null };

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireRole("lecturer");
  const { data: s } = await supabase.from("class_sessions")
    .select("id, title, status, join_code, opens_at, closes_at, late_after, require_gps, module_id, modules(code, title), venues(name, lat, lng, radius_m, polygon)")
    .eq("id", id).maybeSingle();
  if (!s) notFound();
  const [{ data: enrolled }, { data: recs }] = await Promise.all([
    supabase.from("module_enrolments").select("students(id, student_number, full_name)").eq("module_id", s.module_id).eq("status", "active"),
    supabase.from("attendance_records").select("student_id, status, score, checked_in_at, explanation, method, override_note").eq("session_id", id),
  ]);
  const byStudent = new Map(((recs ?? []) as Rec[]).map((r) => [r.student_id, r]));
  const roster = (enrolled ?? []).map((e) => e.students as unknown as { id: string; student_number: string; full_name: string })
    .sort((a, b) => a.student_number.localeCompare(b.student_number));
  const count = (st: string) => (recs ?? []).filter((r) => r.status === st).length;
  const mod = s.modules as unknown as { code: string; title: string };
  const open = s.status === "open";
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
          {open ? <LiveQr session={id} /> : <Card><Badge status={s.status} /> <span className="ml-2 text-sm text-muted">This session is {s.status}.</span></Card>}
          {venue && (venue.polygon || venue.lat != null) && <VenueMap venue={venue} height={220} />}
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Present" value={count("present")} />
            <Stat label="Late" value={count("late")} />
            <Stat label="To review" value={count("pending_verification")} />
            <Stat label={open ? "Not yet in" : "Absent"} value={open ? roster.length - (recs ?? []).length : count("absent")} />
          </div>
          <Card>
            <CardTitle>Correct a record</CardTitle>
            <ActionForm action={override} submit="Save correction" pending="Saving…">
              <input type="hidden" name="session" value={id} />
              <Field label="Student">
                <Select name="student" required>
                  {roster.map((st) => <option key={st.id} value={st.id}>{st.student_number} · {st.full_name}</option>)}
                </Select>
              </Field>
              <Field label="Status">
                <Select name="status" defaultValue="present">
                  <option value="present">Present</option><option value="late">Late</option>
                  <option value="excused">Excused</option><option value="absent">Absent</option>
                </Select>
              </Field>
              <Field label="Reason" hint="Required. Kept in the audit log."><Input name="note" required minLength={3} /></Field>
            </ActionForm>
          </Card>
        </div>

        <Card>
          <CardTitle>Register ({roster.length})</CardTitle>
          <Table head={["Student", "Status", "Time", "Confidence", "Why"]}>
            {roster.map((st) => {
              const r = byStudent.get(st.id);
              return (
                <tr key={st.id}>
                  <Td><b className="font-mono">{st.student_number}</b> {st.full_name}</Td>
                  <Td>{r ? <Badge status={r.status} /> : <span className="text-muted">—</span>}</Td>
                  <Td className="text-xs">{r?.checked_in_at ? new Date(r.checked_in_at).toLocaleTimeString("en-ZA") : ""}</Td>
                  <Td>{r?.score != null ? `${r.score}` : ""}</Td>
                  <Td className="max-w-xs text-xs text-muted">{r?.override_note ? `Corrected: ${r.override_note}` : (r?.explanation ?? []).join(" ")}</Td>
                </tr>
              );
            })}
          </Table>
        </Card>
      </div>
    </>
  );
}
