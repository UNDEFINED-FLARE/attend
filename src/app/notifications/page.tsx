import Link from "next/link";
import { redirect } from "next/navigation";
import { markAllRead } from "@/app/actions";
import { Button, Card, PageHeader, when } from "@/components/ui";
import { getSession } from "@/lib/auth";

export const metadata = { title: "Notifications" };

export default async function Notifications() {
  const s = await getSession();
  if (!s) redirect("/login");
  const { data } = await s.supabase.from("notifications")
    .select("id, title, body, link, read_at, created_at").order("created_at", { ascending: false }).limit(100);
  const items = data ?? [];
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/dashboard" className="text-sm text-info hover:underline">← Back</Link>
      <PageHeader title="Notifications" action={
        <form action={markAllRead}><Button variant="secondary">Mark all read</Button></form>} />
      <Card className="divide-y divide-line p-0">
        {items.length === 0 && <p className="p-6 text-center text-muted">No notifications.</p>}
        {items.map((n) => (
          <div key={n.id} className={`p-4 ${n.read_at ? "opacity-70" : ""}`}>
            <div className="flex justify-between gap-3">
              <p className="font-medium">{!n.read_at && <span className="mr-2 inline-block size-2 rounded-full bg-info" aria-label="unread" />}{n.title}</p>
              <time className="shrink-0 text-xs text-muted">{when(n.created_at)}</time>
            </div>
            {n.body && <p className="mt-1 text-sm text-muted">{n.body}</p>}
            {n.link && <Link href={n.link} className="mt-1 inline-block text-sm text-info hover:underline">Open</Link>}
          </div>
        ))}
      </Card>
    </main>
  );
}
