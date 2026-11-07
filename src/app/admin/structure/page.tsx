import { ActionForm } from "@/components/form";
import { Card, CardTitle, Field, Input, PageHeader, Select, Table, Td, Textarea } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { addDepartment, addFaculty, addVenue } from "../actions";

export const metadata = { title: "Faculties & venues" };

export default async function Structure() {
  const { supabase, institutionId } = await requireRole("institution_admin");
  const [{ data: faculties }, { data: departments }, { data: venues }] = await Promise.all([
    supabase.from("faculties").select("id, name, code").eq("institution_id", institutionId).is("deleted_at", null).order("name"),
    supabase.from("departments").select("id, name, code, faculties(code)").eq("institution_id", institutionId).is("deleted_at", null).order("name"),
    supabase.from("venues").select("id, name, code, capacity, lat, lng, radius_m, polygon").eq("institution_id", institutionId).is("deleted_at", null).order("name"),
  ]);

  return (
    <>
      <PageHeader title="Faculties & venues" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Faculties</CardTitle>
          <ul className="mb-4 divide-y divide-line text-sm">
            {(faculties ?? []).map((f) => <li key={f.id} className="py-2"><b>{f.code}</b> {f.name}</li>)}
            {!faculties?.length && <li className="py-2 text-muted">None yet.</li>}
          </ul>
          <ActionForm action={addFaculty} submit="Add faculty" className="grid grid-cols-[1fr_7rem] items-end gap-2 [&>button]:col-span-2 [&>[role]]:col-span-2">
            <Field label="Name"><Input name="name" placeholder="Faculty of Science" required /></Field>
            <Field label="Code"><Input name="code" placeholder="SCI" required /></Field>
          </ActionForm>
        </Card>
        <Card>
          <CardTitle>Departments</CardTitle>
          <ul className="mb-4 divide-y divide-line text-sm">
            {(departments ?? []).map((d) => <li key={d.id} className="py-2"><b>{d.code}</b> {d.name} <span className="text-muted">· {(d.faculties as unknown as { code: string })?.code}</span></li>)}
            {!departments?.length && <li className="py-2 text-muted">None yet.</li>}
          </ul>
          {faculties?.length ? (
            <ActionForm action={addDepartment} submit="Add department">
              <Field label="Faculty"><Select name="faculty_id">{faculties.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select></Field>
              <div className="grid grid-cols-[1fr_7rem] gap-2">
                <Field label="Name"><Input name="name" placeholder="Computer Science" required /></Field>
                <Field label="Code"><Input name="code" placeholder="CSC" required /></Field>
              </div>
            </ActionForm>
          ) : <p className="text-sm text-muted">Add a faculty first.</p>}
        </Card>
      </div>

      <Card className="mt-6">
        <CardTitle>Lecture venues</CardTitle>
        <Table head={["Venue", "Capacity", "Location check"]} empty="No venues yet. Without a mapped venue, sessions run without the location check.">
          {(venues ?? []).map((v) => (
            <tr key={v.id}>
              <Td><b>{v.name}</b> {v.code && <span className="text-muted">{v.code}</span>}</Td>
              <Td>{v.capacity ?? "—"}</Td>
              <Td className="text-xs">{v.polygon ? `Boundary, ${(v.polygon as unknown[]).length} points` : v.lat != null ? `${v.radius_m} m around ${v.lat.toFixed(5)}, ${v.lng.toFixed(5)}` : "Not mapped"}</Td>
            </tr>
          ))}
        </Table>
        <div className="mt-6 border-t border-line pt-5">
          <h3 className="mb-3 text-sm font-semibold">Add a venue</h3>
          <ActionForm action={addVenue} submit="Add venue" className="grid gap-3 sm:grid-cols-3 [&>button]:sm:col-span-3 [&>[role]]:sm:col-span-3">
            <Field label="Name"><Input name="name" placeholder="New Lecture Hall 1" required /></Field>
            <Field label="Code"><Input name="code" placeholder="NLH1" /></Field>
            <Field label="Capacity"><Input name="capacity" type="number" min={1} /></Field>
            <Field label="Latitude" hint="From Google Maps: right-click the hall → copy coordinates."><Input name="lat" inputMode="decimal" placeholder="-22.97610" required /></Field>
            <Field label="Longitude"><Input name="lng" inputMode="decimal" placeholder="30.44450" required /></Field>
            <Field label="Radius (m)" hint="Half the building's width plus ~15 m."><Input name="radius_m" type="number" min={5} max={2000} defaultValue={40} required /></Field>
            <div className="sm:col-span-3">
              <Field label="Boundary (optional)" hint='More precise than a radius: [[lat,lng],[lat,lng],[lat,lng],...] around the building.'>
                <Textarea name="polygon" placeholder="[[-22.9760,30.4443],[-22.9760,30.4447],[-22.9763,30.4447],[-22.9763,30.4443]]" />
              </Field>
            </div>
          </ActionForm>
        </div>
      </Card>
    </>
  );
}
