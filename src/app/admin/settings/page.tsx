import { ActionForm, Submit } from "@/components/form";
import { Card, CardTitle, Field, Input, PageHeader, Select } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { addAttendanceStatus, saveBranding, saveSettings, toggleAttendanceStatus } from "../actions";

export const metadata = { title: "Policy & branding" };

const COUNTS: Record<string, string> = { present: "present (attended)", late: "late (attended)", absent: "absent", excused: "excused (not counted)" };

function Toggle({ name, label, hint, on }: { name: string; label: string; hint: string; on: boolean }) {
  return (
    <label className="flex items-start gap-3 rounded-lg border border-line p-3">
      <input type="checkbox" name={name} defaultChecked={on} className="mt-1 size-4" />
      <span><span className="block text-sm font-medium">{label}</span><span className="text-xs text-muted">{hint}</span></span>
    </label>
  );
}

export default async function Settings() {
  const { supabase, institutionId } = await requireRole("institution_admin");
  const [{ data: s }, { data: inst }, { data: statuses, error: statusError }] = await Promise.all([
    supabase.from("institution_settings").select("*").eq("institution_id", institutionId).single(),
    supabase.from("institutions").select("name, brand_primary, student_number_pattern").eq("id", institutionId).single(),
    supabase.from("attendance_statuses").select("id, name, color, category, description, active").eq("institution_id", institutionId).order("sort_order").order("name"),
  ]);
  if (!s || !inst) return null;
  return (
    <>
      <PageHeader title="Policy & branding" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle>Attendance policy</CardTitle>
          <ActionForm action={saveSettings} submit="Save policy">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Required attendance (%)"><Input name="min_attendance_pct" type="number" min={0} max={100} defaultValue={s.min_attendance_pct} /></Field>
              <Field label="Late after (minutes)"><Input name="late_after_minutes" type="number" min={0} max={240} defaultValue={s.late_after_minutes} /></Field>
            </div>
            <div className="grid gap-2">
              <Toggle name="require_qr" on={s.require_qr} label="Require the live QR" hint="When on, the typed code is only accepted if the option below is also on." />
              <Toggle name="allow_manual_code" on={s.allow_manual_code} label="Allow typed codes" hint="For students whose camera fails. Scores lower and may go to review." />
              <Toggle name="require_gps" on={s.require_gps} label="Check location" hint="Only for sessions in a mapped venue. Never the sole reason for an absence." />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Default venue radius (m)"><Input name="gps_default_radius_m" type="number" min={10} max={2000} defaultValue={s.gps_default_radius_m} /></Field>
              <Field label="Worst usable GPS accuracy (m)"><Input name="gps_max_accuracy_m" type="number" min={10} max={5000} defaultValue={s.gps_max_accuracy_m} /></Field>
              <Field label="Accept at score ≥" hint="Out of 100. Below this, check-ins go to review."><Input name="accept_score" type="number" min={0} max={100} defaultValue={s.accept_score} /></Field>
              <Field label="Review threshold" hint="Reserved for future auto-flagging."><Input name="review_score" type="number" min={0} max={100} defaultValue={s.review_score} /></Field>
              <Field label="Keep records for (days)" hint="POPIA: no longer than needed."><Input name="retention_days" type="number" min={30} max={3650} defaultValue={s.retention_days} /></Field>
            </div>
          </ActionForm>
        </Card>
        <Card>
          <CardTitle>Branding</CardTitle>
          <ActionForm action={saveBranding} submit="Save">
            <Field label="Institution name"><Input name="name" defaultValue={inst.name} required /></Field>
            <Field label="Primary colour"><Input name="brand_primary" type="color" defaultValue={inst.brand_primary} className="h-10 p-1" /></Field>
            <Field label="Student number format" hint="Regular expression, e.g. ^[0-9]{8}$. Imports are checked against it.">
              <Input name="student_number_pattern" defaultValue={inst.student_number_pattern ?? ""} className="font-mono" />
            </Field>
          </ActionForm>
        </Card>
      </div>

      <Card className="mt-6">
        <CardTitle>Attendance statuses</CardTitle>
        <p className="mb-4 text-sm text-muted">Present, Late, Absent and Excused are always available. Add your own (for example Medical, Field trip, Sports)
          and choose how each one counts: <b className="text-ink">present or late</b> count as attended, <b className="text-ink">absent</b> counts against the student,
          and <b className="text-ink">excused</b> is left out of the percentage.</p>
        {statusError ? <p className="text-sm text-warn">Custom statuses need the latest database update (migration 0014).</p> : (
          <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {(statuses ?? []).length === 0 && <li className="p-4 text-sm text-muted">No custom statuses yet.</li>}
              {(statuses ?? []).map((st) => (
                <li key={st.id} className={`flex flex-wrap items-center gap-3 p-3 ${st.active ? "" : "opacity-50"}`}>
                  <span className="size-4 shrink-0 rounded-full" style={{ background: st.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{st.name}</span>
                    <span className="block text-xs text-muted">Counts as {COUNTS[st.category] ?? st.category}{st.description ? ` · ${st.description}` : ""}</span>
                  </span>
                  <form action={toggleAttendanceStatus}>
                    <input type="hidden" name="id" value={st.id} /><input type="hidden" name="active" value={String(!st.active)} />
                    <Submit label={st.active ? "Turn off" : "Turn on"} variant="secondary" pending="…" />
                  </form>
                </li>
              ))}
            </ul>
            <ActionForm action={addAttendanceStatus} submit="Add status" pending="Adding…">
              <div className="grid grid-cols-[1fr_4rem] gap-2">
                <Field label="Name"><Input name="name" placeholder="Medical" required maxLength={40} /></Field>
                <Field label="Colour"><Input name="color" type="color" defaultValue="#0891b2" className="h-10 p-1" /></Field>
              </div>
              <Field label="Counts as">
                <Select name="category" defaultValue="excused">
                  <option value="present">Present (attended)</option><option value="late">Late (attended)</option>
                  <option value="absent">Absent</option><option value="excused">Excused (not counted)</option>
                </Select>
              </Field>
              <Field label="Description (optional)"><Input name="description" maxLength={200} placeholder="Doctor's note provided" /></Field>
            </ActionForm>
          </div>
        )}
      </Card>
    </>
  );
}
