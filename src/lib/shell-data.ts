import "server-only";
import type { getSession } from "@/lib/auth";

type S = NonNullable<Awaited<ReturnType<typeof getSession>>>;

/** Name/email for the top bar and the unread notification count. */
export async function shellData(s: Pick<S, "user" | "supabase">) {
  const { count } = await s.supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
  const meta = s.user.user_metadata as { full_name?: string } | undefined;
  return { user: { email: s.user.email, name: meta?.full_name || null }, unread: count ?? 0 };
}
