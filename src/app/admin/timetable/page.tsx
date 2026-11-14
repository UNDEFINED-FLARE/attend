import Link from "next/link";
import { ActionForm } from "@/components/form";
import { Icon } from "@/components/icons";
import { Card, CardTitle, Field, Input, PageHeader, Select } from "@/components/ui";
import { DAYS, WeekGrid, type Slot } from "@/components/week-grid";
import { requireRole } from "@/lib/auth";
import { addTimetableSlots, removeTimetableSlot } from "../actions";
import { PdfImport } from "./pdf-import";
import { SourceImport } from "./source-import";
import { ClassesCard } from "./classes-card";

export const metadata = { title: "Timetable" };
// Fetching a batch from the university timetable site can take ~15 s.
export const maxDuration = 60;

export default async function Timetable({ searchParams }: { searchParams: Promise<{ module?: string }> }) {
  const { module: filter } = await searchParams;
  const { supabase, institutionId, current } = await requireRole("institution_admin");
  // Where this institution's timetable is collected from, set by the platform administrator.
  const { data: settings } = await supabase.from("institution_settings").select("*").eq("institution_id", institutionId).maybeSingle();
  const source = settings as { timetable_source_type?: string; timetable_source_url?: string | null } | null;
  const hasSource = !!source?.timetable_source_url && !!source.timetable_source_type && source.timetable_source_type !== "none";
  const sourceLabel = hasSource ? new URL(source!.timetable_source_url!).host.replace(/^www\./, "") : "";
  const soon = new Date(Date.now() + 14 * 86400_000).toISOString();
  const [{ data: modules }, { data: venues }, { data: rows }, upcoming, cancelled] = await Promise.all([
    supabase.from("modules").select("id, code, title").eq("institution_id", institutionId).is("deleted_at", null).order("code"),
    supabase.from("venues").select("id, name").eq("institution_id", institutionId).is("deleted_at", null).order("name"),
    supabase.from("timetables").select("id, weekday, starts_at, ends_at, kind, group_name, module_id, modules(code, title), venues(name)")
      .eq("institution_id", institutionId).order("weekday").order("starts_at"),
    supabase.from("timetable_events").select("id", { count: "exact", head: true }).eq("institution_id", institutionId).gte("starts_at", new Date().toISOString()).lt("starts_at", soon),
    supabase.from("timetable_events").select("id", { count: "exact", head: true }).eq("institution_id", institutionId).eq("status", "cancelled").gte("starts_at", new Date().toISOString()).lt("starts_at", soon),
  ]);
  const kinds = upcoming.error ? null : ((settings as { attendance_kinds?: string[] } | null)?.attendance_kinds ?? ["lecture", "tutorial", "practical"]);
  const all: (Slot & { module_id: string })[] = (rows ?? []).map((r) => {
    const m = r.modules as unknown as { code: string; title: string };
    return { id: r.id, weekday: r.weekday, starts_at: r.starts_at, ends_at: r.ends_at, kind: r.kind, group_name: r.group_name,
             module_id: r.module_id, code: m.code, title: m.title, venue: (r.venues as unknown as { name: string } | null)?.name ?? null };
  });
  const slots = filter ? all.filter((s) => s.module_id === filter) : all;
  const selected = modules?.find((m) => m.id === filter);

  return (
    <>
      <PageHeader title="Timetable" subtitle="Classes added here appear on every enrolled student's timetable and campus map." />
      <ClassesCard kinds={kinds} upcoming={upcoming.count ?? null} cancelled={cancelled.count ?? null} />
      <Card className="mb-6">
        <CardTitle>Import from your timetable source</CardTitle>
        {hasSource
          ? <SourceImport sourceLabel={sourceLabel} />
          : <p className="text-sm text-muted">No timetable source is connected for {current.institution_name ?? "your institution"} yet. UniAttend connects it when your institution is set up; until then, upload timetable PDFs below or add classes by hand.</p>}
      </Card>
      <Card className="mb-6">
        <CardTitle>Import a timetable PDF</CardTitle>
        <PdfImport />
      </Card>
      <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
        <Card className="h-fit">
          <CardTitle>Add a class</CardTitle>
          {!modules?.length ? <p className="text-sm text-muted">Create a <Link href="/admin/modules" className="text-accent">module</Link> first.</p> : (
            <ActionForm action={addTimetableSlots} submit="Add to timetable" pending="Adding…">
              <Field label="Module">
                <Select name="module_id" defaultValue={filter ?? modules[0].id}>
                  {modules.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.title}</option>)}
                </Select>
              </Field>
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium">Days</legend>
                <div className="grid grid-cols-7 gap-1">
                  {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                    <label key={d} className="cursor-pointer">
                      <input type="checkbox" name="weekday" value={d} className="peer sr-only" />
                      <span className="block rounded-lg border border-line py-2 text-center text-xs font-medium text-muted peer-checked:border-accent peer-checked:bg-accent peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-info">{DAYS[d]}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Starts"><Input type="time" name="starts_at" defaultValue="08:00" step={300} required /></Field>
                <Field label="Ends"><Input type="time" name="ends_at" defaultValue="10:00" step={300} required /></Field>
              </div>
              <Field label="Venue" hint={venues?.length ? "A venue can't be double-booked." : "Add venues on the Venues & map page."}>
                <Select name="venue_id" defaultValue=""><option value="">No venue / online</option>
                  {(venues ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Type">
                  <Select name="kind" defaultValue="lecture">
                    {["lecture", "tutorial", "practical", "test", "other"].map((k) => <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>)}
                  </Select>
                </Field>
                <Field label="Group (optional)"><Input name="group_name" maxLength={40} placeholder="Group A" /></Field>
              </div>
            </ActionForm>
          )}
        </Card>

        <Card>
          <CardTitle action={
            <form className="flex items-center gap-2">
              <Select name="module" defaultValue={filter ?? ""} className="h-9 w-56" aria-label="Show module">
                <option value="">All modules</option>
                {(modules ?? []).map((m) => <option key={m.id} value={m.id}>{m.code}</option>)}
              </Select>
              <button className="h-9 rounded-xl border border-line px-3 text-sm hover:bg-bg">Show</button>
            </form>
          }>{selected ? `${selected.code} · ${selected.title}` : "Whole institution"} <span className="font-normal text-muted">· {slots.length} classes a week</span></CardTitle>
          {slots.length === 0
            ? <p className="py-10 text-center text-sm text-muted">No classes yet. Add one on the left.</p>
            : <WeekGrid slots={slots} action={(s) => (
                <form action={removeTimetableSlot}>
                  <input type="hidden" name="id" value={s.id} />
                  <button className="grid size-7 place-items-center rounded-lg text-muted hover:bg-bad/10 hover:text-bad" aria-label={`Remove ${s.code} ${DAYS[s.weekday]} ${s.starts_at.slice(0, 5)}`}>
                    <Icon name="x" size={14} />
                  </button>
                </form>
              )} />}
        </Card>
      </div>
    </>
  );
}
