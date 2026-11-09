import { ActionForm } from "@/components/form";
import { VenueEditor } from "@/components/map/venue-editor";
import { Card, CardTitle, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import type { LatLng } from "@/lib/campuses";
import { addDepartment, addFaculty, addVenuesBulk, removeVenue, saveVenue } from "../actions";
import { AutoMap } from "./auto-map";
import { loadCampuses } from "@/lib/shell-data";
import { DeleteButton } from "@/components/row-actions";

export const metadata = { title: "Faculties & venues" };

export default async function Structure() {
  const { supabase, institutionId } = await requireRole("institution_admin");
  const [{ data: faculties }, { data: departments }, { data: venueRows }] = await Promise.all([
    supabase.from("faculties").select("id, name, code").eq("institution_id", institutionId).is("deleted_at", null).order("name"),
    supabase.from("departments").select("id, name, code, faculties(code)").eq("institution_id", institutionId).is("deleted_at", null).order("name"),
    supabase.from("venues").select("*").eq("institution_id", institutionId).is("deleted_at", null).order("name"),
  ]);
  const campuses = await loadCampuses(supabase, institutionId);
  const venues = (venueRows ?? []).map((v) => ({ ...v, building: (v.building as string | null | undefined) ?? null, polygon: (v.polygon as LatLng[] | null) ?? null }));

  return (
    <>
      <PageHeader title="Faculties & venues" subtitle="Map each lecture venue so students' location can be checked against it." />

      {venues.some((v) => v.lat == null && !v.polygon) && (
        <Card className="mb-6">
          <CardTitle>Auto-map venues</CardTitle>
          <AutoMap venues={venues} campuses={campuses} />
        </Card>
      )}
      <Card className="mb-6">
        <CardTitle>Campus map & lecture venues</CardTitle>
        <VenueEditor venues={venues} campuses={campuses} save={saveVenue} remove={removeVenue} bulk={addVenuesBulk} />
        <div className="mt-6">
          <Table head={["Venue", "Capacity", "Location check"]} empty="No venues yet. Pick a building on the map above.">
            {venues.map((v) => (
              <tr key={v.id}>
                <Td><b>{v.name}</b> {v.code && <span className="text-muted">{v.code}</span>}</Td>
                <Td>{v.capacity ?? "—"}</Td>
                <Td className="text-xs">{v.polygon ? `Building outline, ${v.polygon.length} corners` : v.lat != null ? `${v.radius_m} m radius` : "Not mapped"}</Td>
              </tr>
            ))}
          </Table>
          {venues.length > 0 && <p className="mt-2 text-xs text-muted">Click a venue on the map to edit or remove it.</p>}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Faculties</CardTitle>
          <ul className="mb-4 divide-y divide-line text-sm">
            {(faculties ?? []).map((f) => <li key={f.id} className="flex items-center justify-between py-1.5"><span><b>{f.code}</b> {f.name}</span><DeleteButton kind="faculty" id={f.id} label={f.name} /></li>)}
            {!faculties?.length && <li className="py-2 text-muted">None yet.</li>}
          </ul>
          <ActionForm action={addFaculty} submit="Add faculty">
            <div className="grid grid-cols-[1fr_7rem] gap-2">
              <Field label="Name"><Input name="name" placeholder="Faculty of Science, Engineering and Agriculture" required /></Field>
              <Field label="Code"><Input name="code" placeholder="FSEA" required /></Field>
            </div>
          </ActionForm>
        </Card>
        <Card>
          <CardTitle>Departments</CardTitle>
          <ul className="mb-4 divide-y divide-line text-sm">
            {(departments ?? []).map((d) => <li key={d.id} className="flex items-center justify-between py-1.5"><span><b>{d.code}</b> {d.name} <span className="text-muted">· {(d.faculties as unknown as { code: string })?.code}</span></span><DeleteButton kind="department" id={d.id} label={d.name} /></li>)}
            {!departments?.length && <li className="py-2 text-muted">None yet.</li>}
          </ul>
          {faculties?.length ? (
            <ActionForm action={addDepartment} submit="Add department">
              <Field label="Faculty"><Select name="faculty_id">{faculties.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select></Field>
              <div className="grid grid-cols-[1fr_7rem] gap-2">
                <Field label="Name"><Input name="name" placeholder="Computer Science and Information Systems" required /></Field>
                <Field label="Code"><Input name="code" placeholder="CSIS" required /></Field>
              </div>
            </ActionForm>
          ) : <p className="text-sm text-muted">Add a faculty first.</p>}
        </Card>
      </div>
    </>
  );
}
