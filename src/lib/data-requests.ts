import "server-only";
import type { DataRequestRow } from "@/components/data-requests";
import type { getSession } from "@/lib/auth";

type Supabase = NonNullable<Awaited<ReturnType<typeof getSession>>>["supabase"];

/** Requests this admin may see (RLS decides), with the requester's name. */
export async function loadDataRequests(supabase: Supabase): Promise<{ rows: DataRequestRow[]; error: boolean }> {
  const { data, error } = await supabase.from("data_requests")
    .select("id, user_id, kind, details, status, response, created_at").order("created_at", { ascending: false }).limit(200);
  if (error) return { rows: [], error: true };
  const ids = [...new Set((data ?? []).map((r) => r.user_id as string))];
  const { data: people } = ids.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", ids)
    : { data: [] as { id: string; full_name: string | null; email: string | null }[] };
  const name = new Map((people ?? []).map((p) => [p.id, p.full_name || p.email || "A user"]));
  return {
    rows: (data ?? []).map((r) => ({ id: r.id, kind: r.kind, details: r.details, status: r.status, response: r.response,
      created_at: r.created_at, who: name.get(r.user_id) ?? "A user" })),
    error: false,
  };
}
