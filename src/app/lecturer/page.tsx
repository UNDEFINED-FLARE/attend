import Link from "next/link";
import { Badge, Card, CardTitle, LinkButton, PageHeader, Table, Td, when } from "@/components/ui";
import { requireRole } from "@/lib/auth";

export const metadata = { title: "My modules" };

export default async function LecturerHome() {
  const { supabase, institutionId, user } = await requireRole("lecturer");
  const { data: me } = await supabase.from("lecturers").select("id, full_name")
    .eq("institution_id", institutionId).eq("user_id", user.id).maybeSingle();
  const { data: assigned } = await supabase.from("lecturer_assignments")
    .select("role, modules(id, code, title)").eq("lecturer_id", me?.id ?? "00000000-0000-0000-0000-000000000000");
  const modules = (assigned ?? []).map((a) => ({ role: a.role, ...(a.modules as unknown as { id: string; code: string; title: string }) }));
  const { data: open } = await supabase.from("class_sessions")
    .select("id, title, join_code, opens_at, closes_at, modules(code)")
    .eq("status", "open").in("module_id", modules.map((m) => m.id)).order("opens_at", { ascending: false });

  return (
    <>
      <PageHeader title={`Welcome${me?.full_name ? `, ${me.full_name}` : ""}`} subtitle="Your modules and live sessions." />
      {(open ?? []).length > 0 && (
        <Card className="mb-6 border-ok/40">
          <CardTitle>Live now</CardTitle>
          <ul className="divide-y divide-line">
            {(open ?? []).map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div><b>{(s.modules as unknown as { code: string }).code}</b> {s.title} <span className="font-mono text-muted">{s.join_code}</span>
                  <div className="text-xs text-muted">Closes {when(s.closes_at)}</div></div>
                <LinkButton href={`/lecturer/sessions/${s.id}`}>Open register</LinkButton>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card>
        <CardTitle>Modules</CardTitle>
        <Table head={["Code", "Title", "Role", ""]} empty="No modules are assigned to you yet. Your institution administrator assigns modules.">
          {modules.map((m) => (
            <tr key={m.id}>
              <Td className="font-semibold">{m.code}</Td><Td>{m.title}</Td><Td><Badge>{m.role}</Badge></Td>
              <Td className="text-right"><Link className="text-info hover:underline" href={`/lecturer/modules/${m.id}`}>Open →</Link></Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
