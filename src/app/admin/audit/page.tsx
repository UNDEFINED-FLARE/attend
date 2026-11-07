import { Card, PageHeader, Table, Td, when } from "@/components/ui";
import { requireRole } from "@/lib/auth";

export const metadata = { title: "Audit log" };

export default async function Audit() {
  const { supabase, institutionId } = await requireRole("institution_admin");
  const { data } = await supabase.from("audit_logs").select("id, actor_id, action, entity, entity_id, details, created_at")
    .eq("institution_id", institutionId).order("created_at", { ascending: false }).limit(200);
  return (
    <>
      <PageHeader title="Audit log" subtitle="Role changes, corrections, imports, session lifecycle. Read-only; nobody can edit it." />
      <Card>
        <Table head={["When", "Action", "Record", "Details"]} empty="No activity yet.">
          {(data ?? []).map((a) => (
            <tr key={a.id}>
              <Td className="whitespace-nowrap text-xs">{when(a.created_at)}</Td>
              <Td>{a.action} <span className="text-muted">{a.entity.replace(/_/g, " ")}</span></Td>
              <Td className="font-mono text-xs text-muted">{a.entity_id?.slice(0, 8)}</Td>
              <Td className="max-w-md truncate font-mono text-xs">{JSON.stringify(a.details)}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
