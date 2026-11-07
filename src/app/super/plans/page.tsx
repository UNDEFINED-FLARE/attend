import { ActionForm } from "@/components/form";
import { Card, CardTitle, Field, Input, PageHeader, Select } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { savePlan } from "../actions";

export const metadata = { title: "Plans & pricing" };

export default async function Plans() {
  const { supabase } = await requireRole("super_admin");
  const { data: plans } = await supabase.from("subscription_plans").select("*").order("sort_order");
  return (
    <>
      <PageHeader title="Plans & pricing" subtitle="Prices are blank until you set them. Blank limits mean unlimited." />
      <div className="grid gap-6 lg:grid-cols-3">
        {(plans ?? []).map((p) => (
          <Card key={p.id}>
            <CardTitle>{p.name} <span className="text-xs font-normal text-muted">{p.code}</span></CardTitle>
            <p className="mb-4 text-sm text-muted">{p.description}</p>
            <ActionForm action={savePlan} submit="Save plan">
              <input type="hidden" name="id" value={p.id} />
              <Field label="Name"><Input name="name" defaultValue={p.name} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label={`Price (${p.currency})`} hint="Blank = contact sales"><Input name="price" type="number" step="0.01" min={0} defaultValue={p.price_cents != null ? p.price_cents / 100 : ""} /></Field>
                <Field label="Billed"><Select name="billing_interval" defaultValue={p.billing_interval}><option value="month">Monthly</option><option value="year">Yearly</option></Select></Field>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Students"><Input name="max_students" type="number" min={1} defaultValue={p.max_students ?? ""} /></Field>
                <Field label="Lecturers"><Input name="max_lecturers" type="number" min={1} defaultValue={p.max_lecturers ?? ""} /></Field>
                <Field label="Modules"><Input name="max_modules" type="number" min={1} defaultValue={p.max_modules ?? ""} /></Field>
              </div>
              <p className="text-xs text-muted">Features: {Object.entries(p.features as Record<string, boolean>).filter(([, v]) => v).map(([k]) => k.replace(/_/g, " ")).join(", ") || "core"}</p>
            </ActionForm>
          </Card>
        ))}
      </div>
    </>
  );
}
