import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { markAllRead } from "@/app/actions";
import { Icon, type IconName } from "@/components/icons";
import { PushToggle } from "@/components/push-toggle";
import { getSession, INST_COOKIE, ROLE_HOME } from "@/lib/auth";
import { loadTheme } from "@/lib/shell-data";
import { sastMidnight, timeOf } from "@/lib/stats";
import { themeStyle } from "@/lib/theme";

export const metadata = { title: "Notifications" };

const KIND: Record<string, { icon: IconName; tone: string; group: "classes" | "announcements" | "attendance" }> = {
  class_reminder: { icon: "calendar", tone: "bg-accent/10 text-accent", group: "classes" },
  announcement: { icon: "bell", tone: "bg-violet/10 text-violet", group: "announcements" },
  session_open: { icon: "scan", tone: "bg-ok/10 text-ok", group: "attendance" },
  check_in_ok: { icon: "check", tone: "bg-ok/10 text-ok", group: "attendance" },
  check_in_review: { icon: "alert", tone: "bg-warn/10 text-warn", group: "attendance" },
  attendance_corrected: { icon: "file", tone: "bg-info/10 text-info", group: "attendance" },
  test: { icon: "bell", tone: "bg-accent/10 text-accent", group: "announcements" },
};
const look = (kind: string) => KIND[kind] ?? (/dispute/.test(kind) ? { icon: "flag" as IconName, tone: "bg-warn/10 text-warn", group: "attendance" as const } : { icon: "bell" as IconName, tone: "bg-bg text-muted", group: "attendance" as const });
const FILTERS = [["all", "All"], ["classes", "Classes"], ["announcements", "News"], ["attendance", "Attendance"]] as const;

function ago(iso: string) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m} min`;
  if (m < 24 * 60) return `${Math.floor(m / 60)} h`;
  return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", timeZone: "Africa/Johannesburg" });
}

export default async function Notifications({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const show = ((await searchParams).show ?? "all") as (typeof FILTERS)[number][0];
  const s = await getSession();
  if (!s) redirect("/login");
  const wanted = (await cookies()).get(INST_COOKIE)?.value;
  const role = s.roles.find((r) => r.institution_id === wanted) ?? s.roles.find((r) => r.institution_id) ?? s.roles[0];
  const [{ data }, theme] = await Promise.all([
    s.supabase.from("notifications").select("id, kind, title, body, link, read_at, created_at").order("created_at", { ascending: false }).limit(150),
    loadTheme(s.supabase, role?.institution_id ?? null),
  ]);
  const all = data ?? [];
  const items = show === "all" ? all : all.filter((n) => look(n.kind).group === show);
  const unread = all.filter((n) => !n.read_at).length;
  const logo = theme.header.logoUrl || null;
  const instName = theme.header.title || role?.institution_name || "UniAttend";
  const today = sastMidnight(0);
  const groups: [string, typeof items][] = [
    ["Today", items.filter((n) => n.created_at >= today)],
    ["Earlier", items.filter((n) => n.created_at < today)],
  ];

  return (
    <div style={themeStyle(theme)} className="min-h-dvh font-sans">
      <main className="mx-auto max-w-2xl px-4 pb-16 pt-[max(20px,env(safe-area-inset-top))]">
        <div className="mb-5 flex items-center justify-between">
          <Link href={role ? ROLE_HOME[role.role] : "/dashboard"} className="grid size-11 place-items-center rounded-2xl bg-surface shadow-card" aria-label="Back">
            <Icon name="arrowRight" size={18} className="rotate-180" />
          </Link>
          {unread > 0 && <form action={markAllRead}><button className="h-11 rounded-2xl bg-surface px-4 text-sm font-semibold text-accent shadow-card">Mark all read</button></form>}
        </div>

        {/* The institution's identity on top, like the notification itself. */}
        <section className="relative mb-5 overflow-hidden rounded-[28px] bg-gradient-to-br from-brand to-accent p-5 text-white shadow-card">
          <span aria-hidden className="absolute -right-8 -top-10 size-36 rounded-full bg-white/10" />
          <div className="relative flex items-center gap-4">
            {logo
              // eslint-disable-next-line @next/next/no-img-element -- the institution's logo from an admin-set https URL
              ? <img src={logo} alt="" className="size-16 shrink-0 rounded-2xl bg-white object-contain p-1.5" referrerPolicy="no-referrer" />
              : <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-white/15"><Icon name="check" size={32} strokeWidth={2.6} /></span>}
            <div className="min-w-0">
              <p className="truncate text-sm opacity-80">{instName}</p>
              <h1 className="text-[28px] font-bold leading-tight tracking-tight">Notifications</h1>
              <p className="text-sm opacity-80">{unread ? `${unread} unread` : "You're all caught up"}</p>
            </div>
          </div>
        </section>

        <div className="mb-5"><PushToggle logo={logo} institution={instName} /></div>

        <div className="mb-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Show">
          {FILTERS.map(([k, label]) => (
            <Link key={k} href={k === "all" ? "/notifications" : `/notifications?show=${k}`} role="tab" aria-selected={show === k}
              className={`h-10 shrink-0 rounded-full px-5 text-sm font-semibold leading-10 transition ${show === k ? "bg-accent text-white shadow-[0_8px_20px_color-mix(in_srgb,var(--accent)_35%,transparent)]" : "bg-surface text-muted shadow-card"}`}>
              {label}
            </Link>
          ))}
        </div>

        {items.length === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-3xl bg-surface p-10 text-center shadow-card">
            <span className="grid size-14 place-items-center rounded-full bg-accent/10 text-accent"><Icon name="bell" size={26} /></span>
            <p className="text-sm text-muted">Nothing here yet.</p>
          </div>
        )}

        <div className="space-y-6">
          {groups.filter(([, list]) => list.length).map(([label, list]) => (
            <section key={label}>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted">{label}</p>
              <ul className="space-y-2.5">
                {list.map((n) => {
                  const k = look(n.kind);
                  const inner = (
                    <>
                      <span className={`relative grid size-12 shrink-0 place-items-center rounded-2xl ${k.tone}`}>
                        <Icon name={k.icon} size={22} />
                        {!n.read_at && <span className="absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-surface bg-accent" aria-label="Unread" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className={`truncate text-sm ${n.read_at ? "font-semibold" : "font-bold"}`}>{n.title}</span>
                          <time className="shrink-0 text-[11px] text-muted" dateTime={n.created_at}>{ago(n.created_at)}</time>
                        </span>
                        {n.body && <span className="mt-0.5 line-clamp-3 block text-xs leading-relaxed text-muted">{n.body}</span>}
                        {n.kind === "announcement" && <span className="mt-1 block text-[11px] font-semibold text-violet">{instName} · {timeOf(n.created_at)}</span>}
                      </span>
                      {n.link && n.link !== "/notifications" && <Icon name="arrowRight" size={16} className="mt-1 shrink-0 text-muted" />}
                    </>
                  );
                  return (
                    <li key={n.id}>
                      {n.link && n.link !== "/notifications"
                        ? <Link href={n.link} className={`flex items-start gap-3 rounded-3xl bg-surface p-3 pr-4 shadow-card transition hover:-translate-y-0.5 ${n.read_at ? "" : "ring-1 ring-accent/25"}`}>{inner}</Link>
                        : <div className={`flex items-start gap-3 rounded-3xl bg-surface p-3 pr-4 shadow-card ${n.read_at ? "" : "ring-1 ring-accent/25"}`}>{inner}</div>}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
