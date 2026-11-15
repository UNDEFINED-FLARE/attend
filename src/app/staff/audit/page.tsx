import { redirect } from "next/navigation";
import { Card, CardTitle, PageHeader, Table, Td, when } from "@/components/ui";
import { requireAnyRole, ROLE_LABEL, STAFF_ROLES, type Role } from "@/lib/auth";

export const metadata = { title: "Audit log" };

// Auditors: the audit log and who holds which role. Read-only by design (no write policies).
export default async function StaffAudit() {
  const { supabase, institutionId, roles } = await requireAnyRole(STAFF_ROLES);
  if (!roles.some((r) => r.role === "auditor")) redirect("/staff");
  const [{ data: logs }, { data: grants }] = await Promise.all([
    supabase.from("audit_logs").select("id, actor_id, action, entity, entity_id, details, created_at")
      .eq("institution_id", institutionId).order("created_at", { ascending: false }).limit(300),
    supabase.from("user_roles").select("id, user_id, role, status, created_at").eq("institution_id", institutionId)
      .neq("role", "student").order("role"),
  ]);
  const ids = [...new Set([...(logs ?? []).map((l) => l.actor_id), ...(grants ?? []).map((g) => g.user_id)].filter(Boolean))] as string[];
  const { data: people } = ids.length ? await supabase.from("profiles").select("id, full_name, email").in("id", ids) : { data: [] };
  const name = new Map((people ?? []).map((p) => [p.id, p.full_name || p.email || "Account"]));
  return (
    <>
      <PageHeader title="Audit log" subtitle="Role changes, attendance corrections, review decisions, exports and imports. Nobody can edit it." />
      <Card className="mb-6">
        <CardTitle>Activity (latest 300)</CardTitle>
        <Table head={["When", "Who", "Action", "Details"]} empty="No activity yet.">
          {(logs ?? []).map((a) => (
            <tr key={a.id}>
              <Td className="whitespace-nowrap text-xs">{when(a.created_at)}</Td>
              <Td className="text-xs">{a.actor_id ? name.get(a.actor_id) ?? "Account" : "System"}</Td>
              <Td>{a.action} <span className="text-muted">{a.entity.replace(/_/g, " ")}</span></Td>
              <Td className="max-w-md truncate font-mono text-xs">{JSON.stringify(a.details)}</Td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card>
        <CardTitle>Who holds which role</CardTitle>
        <Table head={["Person", "Role", "Status", "Since"]} empty="No roles.">
          {(grants ?? []).map((g) => (
            <tr key={g.id}>
              <Td>{name.get(g.user_id) ?? "Account"}</Td>
              <Td>{ROLE_LABEL[g.role as Role] ?? g.role}</Td>
              <Td>{g.status}</Td>
              <Td className="text-xs">{when(g.created_at)}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
