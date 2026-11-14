import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/form";
import { Badge, Card, CardTitle, Field, Input, LinkButton, PageHeader, pct, Select, Table, Td, when } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { openSession } from "../../actions";
import { sendClassMessage } from "@/app/push-actions";
import { Textarea } from "@/components/ui";

type ReportRow = { student_id: string; student_number: string; full_name: string; sessions: number; attended: number;
  late: number; absent: number; excused: number; unresolved: number; percent: number | null;
  worst_case_percent: number | null; meets_requirement: boolean | null; at_risk: boolean | null };

export default async function ModulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, institutionId } = await requireRole("lecturer");
  const { data: mod } = await supabase.from("modules").select("id, code, title").eq("id", id).maybeSingle();
  if (!mod) notFound();
  const [{ data: report, error }, { data: venues }, { data: sessions }] = await Promise.all([
    supabase.rpc("module_report", { p_module: id }),
    supabase.from("venues").select("id, name").eq("institution_id", institutionId).is("deleted_at", null).order("name"),
    supabase.from("class_sessions").select("id, title, status, opens_at, join_code").eq("module_id", id)
      .order("opens_at", { ascending: false }).limit(30),
  ]);
  if (error) notFound(); // not assigned to this module
  const rows = (report ?? []) as ReportRow[];

  return (
    <>
      <PageHeader title={`${mod.code} · ${mod.title}`} subtitle={`${rows.length} students enrolled`}
        action={<LinkButton variant="secondary" href={`/lecturer/modules/${id}/export`}>Export CSV</LinkButton>} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardTitle>Start attendance</CardTitle>
          <ActionForm action={openSession} submit="Open session" pending="Opening…">
            <input type="hidden" name="module" value={id} />
            <Field label="Title"><Input name="title" placeholder={`${mod.code} lecture`} /></Field>
            <Field label="Venue" hint="Mapped venues enable the location check.">
              <Select name="venue" defaultValue="">
                <option value="">No venue (no location check)</option>
                {(venues ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Open for (min)"><Input name="minutes" type="number" min={5} max={480} defaultValue={90} /></Field>
              <Field label="Late after (min)"><Input name="late" type="number" min={0} max={240} defaultValue={10} /></Field>
            </div>
          </ActionForm>
          <div className="mt-6 border-t border-line pt-5">
            <CardTitle>Message this class</CardTitle>
            <ActionForm action={sendClassMessage} submit="Send to students" pending="Sending…">
              <input type="hidden" name="module" value={id} />
              <Field label="Type">
                <Select name="category" defaultValue="announcement">
                  <option value="announcement">General</option><option value="class_cancelled">Class cancelled</option>
                  <option value="venue_change">Venue change</option><option value="timetable_change">Timetable change</option>
                  <option value="class_reminder">Reminder</option>
                </Select>
              </Field>
              <Field label="Title"><Input name="title" placeholder="Today's lecture moves to Hall 2" required maxLength={150} /></Field>
              <Field label="Message" hint={`Goes to every student in ${mod.code}: their inbox, and their phone if notifications are on.`}>
                <Textarea name="body" required maxLength={2000} placeholder="Same time, 10:00. See you there." />
              </Field>
            </ActionForm>
          </div>
        </Card>
        <Card className="lg:col-span-2">
          <CardTitle>Sessions</CardTitle>
          <Table head={["Date", "Title", "Code", "Status", ""]} empty="No sessions yet.">
            {(sessions ?? []).map((s) => (
              <tr key={s.id}>
                <Td>{when(s.opens_at)}</Td><Td>{s.title}</Td><Td className="font-mono">{s.join_code}</Td>
                <Td><Badge status={s.status} /></Td>
                <Td className="text-right"><Link className="text-info hover:underline" href={`/lecturer/sessions/${s.id}`}>Register →</Link></Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
      <Card className="mt-6">
        <CardTitle>Attendance report</CardTitle>
        <p className="-mt-2 mb-3 text-xs text-muted">
          Percentages count resolved sessions only. &ldquo;Worst case&rdquo; treats every pending or disputed record as an absence.
        </p>
        <Table head={["Student", "Attended", "Late", "Absent", "Excused", "Pending", "Attendance", "Worst case"]}>
          {rows.map((r) => (
            <tr key={r.student_id} className={r.at_risk ? "bg-bad/5" : ""}>
              <Td><b className="font-mono">{r.student_number}</b> {r.full_name}</Td>
              <Td>{r.attended}</Td><Td>{r.late}</Td><Td>{r.absent}</Td><Td>{r.excused}</Td><Td>{r.unresolved}</Td>
              <Td className={r.meets_requirement === false ? "font-semibold text-bad" : "font-semibold"}>{pct(r.percent)}</Td>
              <Td className="text-muted">{pct(r.worst_case_percent)}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
