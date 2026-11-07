import { ActionForm } from "@/components/form";
import { Card, CardTitle, Field, Input, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { saveBranding, saveSettings } from "../actions";

export const metadata = { title: "Policy & branding" };

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
  const [{ data: s }, { data: inst }] = await Promise.all([
    supabase.from("institution_settings").select("*").eq("institution_id", institutionId).single(),
    supabase.from("institutions").select("name, brand_primary, student_number_pattern").eq("id", institutionId).single(),
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
    </>
  );
}
