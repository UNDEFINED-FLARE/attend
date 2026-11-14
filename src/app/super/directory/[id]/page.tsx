import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/form";
import { CampusesEditor } from "@/components/map/campuses-editor";
import { Card, CardTitle, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import type { CampusInput } from "@/lib/campus-schema";
import { SourceFields } from "../../source-fields";
import { deleteDirectoryEntry, saveDirectoryEntry, testSource } from "../../setup-actions";

export const metadata = { title: "Directory entry" };

export default async function DirectoryEntry({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireRole("super_admin");
  const isNew = id === "new";
  const { data } = isNew ? { data: null } : await supabase.from("institution_directory").select("*").eq("id", id).maybeSingle();
  if (!isNew && !data) notFound();
  const e = (data ?? { name: "", short_name: "", kind: "university", province: "", website: "", timetable_source_type: "none", timetable_source_url: "", timetable_note: "", campuses: [] }) as {
    id?: string; name: string; short_name: string | null; kind: string; province: string | null; website: string | null;
    timetable_source_type: string; timetable_source_url: string | null; timetable_note: string | null; campuses: CampusInput[] };

  return (
    <>
      <Link href="/super/directory" className="text-sm text-accent underline underline-offset-2 hover:decoration-2">← Directory</Link>
      <PageHeader title={isNew ? "Add an institution" : e.name} subtitle="Campus locations and the timetable link used when this institution is set up." />
      <ActionForm action={saveDirectoryEntry} submit={isNew ? "Add to directory" : "Save"} className="space-y-6">
        <input type="hidden" name="id" value={e.id ?? ""} />
        <Card>
          <CardTitle>Institution</CardTitle>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="md:col-span-2"><Field label="Name"><Input name="name" defaultValue={e.name} required /></Field></div>
            <Field label="Short name"><Input name="short_name" defaultValue={e.short_name ?? ""} /></Field>
            <Field label="Type">
              <Select name="kind" defaultValue={e.kind}>
                <option value="university">University</option><option value="university_of_technology">University of technology</option>
                <option value="tvet_college">TVET college</option><option value="college">College</option>
              </Select>
            </Field>
            <Field label="Province"><Input name="province" defaultValue={e.province ?? ""} /></Field>
            <Field label="Website"><Input name="website" defaultValue={e.website ?? ""} placeholder="https://" /></Field>
          </div>
        </Card>
        <Card>
          <CardTitle>Timetable source</CardTitle>
          <SourceFields type={e.timetable_source_type} url={e.timetable_source_url ?? ""} />
          <div className="mt-3"><Field label="Note"><Textarea name="timetable_note" defaultValue={e.timetable_note ?? ""} rows={2} /></Field></div>
        </Card>
        <Card>
          <CardTitle>Campuses</CardTitle>
          <CampusesEditor initial={e.campuses ?? []} />
        </Card>
      </ActionForm>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Card>
          <CardTitle>Test the timetable link</CardTitle>
          <ActionForm action={testSource} submit="Test" pending="Testing…">
            <SourceFields type={e.timetable_source_type} url={e.timetable_source_url ?? ""} />
          </ActionForm>
        </Card>
        {!isNew && (
          <Card>
            <CardTitle>Remove from directory</CardTitle>
            <p className="mb-3 text-sm text-muted">Institutions already set up from this entry keep their campuses and timetable link.</p>
            <ActionForm action={deleteDirectoryEntry} submit="Remove" pending="Removing…">
              <input type="hidden" name="id" value={e.id} />
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
