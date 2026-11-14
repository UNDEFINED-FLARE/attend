import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, Submit } from "@/components/form";
import { CampusesEditor } from "@/components/map/campuses-editor";
import { Badge, Card, CardTitle, Notice, PageHeader, Select } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import type { CampusInput } from "@/lib/campus-schema";
import { setStatus } from "../../actions";
import { SourceFields } from "../../source-fields";
import { applyDirectoryEntry, saveInstitutionCampuses, saveInstitutionSource, testSource } from "../../setup-actions";

export const metadata = { title: "Set up institution" };

/** Word overlap, to suggest the directory entry that matches a registration. */
function similarity(a: string, b: string) {
  const w = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((x) => x.length > 2 && !["university", "college", "the", "and", "tvet", "technology"].includes(x)));
  const A = w(a), B = w(b);
  return [...A].filter((x) => B.has(x)).length;
}

export default async function SetUpInstitution({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireRole("super_admin");
  const [{ data: inst }, { data: settings }, { data: campusRows }, { data: dir }] = await Promise.all([
    supabase.from("institutions").select("*").eq("id", id).maybeSingle(),
    supabase.from("institution_settings").select("*").eq("institution_id", id).maybeSingle(),
    supabase.from("campuses").select("*").eq("institution_id", id).is("deleted_at", null).order("name"),
    supabase.from("institution_directory").select("id, name, short_name").order("name"),
  ]);
  if (!inst) notFound();
  const s = (settings ?? {}) as { timetable_source_type?: string; timetable_source_url?: string | null };
  const campuses: CampusInput[] = (campusRows ?? []).map((c) => ({
    name: c.name, town: c.town ?? null, lat: c.lat, lng: c.lng, zoom: c.zoom ?? 16, outline: c.outline ?? null, osm: c.osm_ref ?? null,
  }));
  const ranked = [...(dir ?? [])].sort((a, b) => similarity(`${inst.name} ${inst.slug}`, `${b.name} ${b.short_name ?? ""}`) - similarity(`${inst.name} ${inst.slug}`, `${a.name} ${a.short_name ?? ""}`));
  const suggestion = ranked[0] && similarity(`${inst.name} ${inst.slug}`, `${ranked[0].name} ${ranked[0].short_name ?? ""}`) > 0 ? ranked[0] : null;

  return (
    <>
      <Link href="/super" className="text-sm text-accent underline underline-offset-2 hover:decoration-2">← Institutions</Link>
      <PageHeader title={`Set up ${inst.name}`}
        subtitle={<>/{inst.slug} · {inst.contact_email ?? "no contact email"} · <Badge status={inst.status} /></>}
        action={inst.status === "pending" && (
          <form action={setStatus}><input type="hidden" name="id" value={inst.id} /><input type="hidden" name="status" value="active" /><Submit label="Approve institution" /></form>
        )} />

      <Card className="mb-6">
        <CardTitle>1. Start from the directory</CardTitle>
        {!dir ? <Notice tone="warn">The directory needs the latest database update (migration 0009).</Notice> : (
          <ActionForm action={applyDirectoryEntry} submit="Apply campuses and timetable link" pending="Applying…" className="flex flex-wrap items-end gap-2 [&>[role]]:w-full">
            <input type="hidden" name="institution_id" value={inst.id} />
            <Select name="entry_id" defaultValue={suggestion?.id ?? ""} className="max-w-md" required>
              <option value="" disabled>Choose a directory entry…</option>
              {(dir ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}{d.id === suggestion?.id ? " (suggested)" : ""}</option>)}
            </Select>
          </ActionForm>
        )}
        <p className="mt-2 text-xs text-muted">Adds the entry&apos;s campuses (existing ones with the same name are kept) and sets its timetable link. Not listed? <Link className="text-accent" href="/super/directory/new">Add it to the directory</Link> or set it up directly below.</p>
      </Card>

      <Card className="mb-6">
        <CardTitle>2. Campus map</CardTitle>
        <ActionForm action={saveInstitutionCampuses} submit="Save campuses" pending="Saving…">
          <input type="hidden" name="institution_id" value={inst.id} />
          <CampusesEditor key={campuses.length} initial={campuses} />
        </ActionForm>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>3. Timetable source</CardTitle>
          <ActionForm action={saveInstitutionSource} submit="Save timetable source" pending="Saving…">
            <input type="hidden" name="institution_id" value={inst.id} />
            <SourceFields type={s.timetable_source_type ?? "none"} url={s.timetable_source_url ?? ""} />
          </ActionForm>
        </Card>
        <Card>
          <CardTitle>Test a timetable link</CardTitle>
          <ActionForm action={testSource} submit="Test" pending="Testing…">
            <SourceFields type={s.timetable_source_type ?? "none"} url={s.timetable_source_url ?? ""} />
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
