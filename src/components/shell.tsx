import Link from "next/link";
import type { ReactNode } from "react";
import { signOut, switchInstitution } from "@/app/actions";
import { AppProvider, AppTabBar } from "@/components/app-chrome";
import { Icon } from "@/components/icons";
import { SideNav, TabBar, type NavItem } from "@/components/nav";
import type { RoleRow } from "@/lib/auth";
import { DEFAULT_THEME, inkOn, themeStyle, type Theme } from "@/lib/theme";

export type { NavItem };

function Logo({ name, theme, onDark }: { name: string; theme: Theme; onDark: boolean }) {
  const title = theme.header.title || "UniAttend";
  return (
    <Link href="/dashboard" className="flex min-w-0 items-center gap-2.5">
      {theme.header.logoUrl
        // eslint-disable-next-line @next/next/no-img-element -- institution logo from an admin-set https URL
        ? <img src={theme.header.logoUrl} alt="" className="size-9 shrink-0 rounded-xl bg-white object-contain p-0.5" referrerPolicy="no-referrer" />
        : <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand text-brand-ink"><Icon name="check" size={20} strokeWidth={2.6} /></span>}
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[15px] font-semibold">{title}</span>
        <span className={`block max-w-44 truncate text-xs ${onDark ? "opacity-75" : "text-muted"}`}>{theme.header.subtitle || name}</span>
      </span>
    </Link>
  );
}

const TONE = { info: "bg-info/10 text-info", ok: "bg-ok/10 text-ok", warn: "bg-warn/10 text-warn", bad: "bg-bad/10 text-bad" } as const;

export function Shell({ nav, children, current, choices, area, user, unread = 0, theme = DEFAULT_THEME, app }: {
  nav: NavItem[];
  children: ReactNode;
  current: RoleRow;
  choices: RoleRow[];
  area: string;
  user: { email?: string | null; name?: string | null };
  unread?: number;
  theme?: Theme;
  /** Phone-app layout (students): page titles carry the avatar, and a floating tab bar raises this item. */
  app?: { center: string };
}) {
  const instName = current.institution_name ?? "Platform";
  const who = user.name || user.email || "";
  const initials = (user.name || user.email || "?").split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const today = new Date().toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Johannesburg" });

  // Sidebar and header styles chosen on the Design page.
  const side = theme.sidebar.style;
  const sideBg = side === "dark" ? "#0f172a" : side === "brand" ? theme.colors.primary : theme.colors.surface;
  const sideDark = side !== "light";
  const head = theme.header.style;
  const headBg = head === "solid" ? theme.colors.primary
    : head === "gradient" ? `linear-gradient(90deg, ${theme.colors.primary}, ${theme.header.gradientTo})` : undefined;
  const headInk = head === "light" ? undefined : inkOn(theme.colors.primary);

  return (
    <div style={themeStyle(theme)} className="min-h-dvh font-sans">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-line px-4 py-5 lg:flex"
        style={{ background: sideBg, color: sideDark ? inkOn(sideBg) : undefined, ["--muted" as string]: sideDark ? "rgb(255 255 255 / 0.7)" : undefined }}>
        <Logo name={instName} theme={theme} onDark={sideDark} />
        <p className="mt-8 mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted">{area}</p>
        <SideNav items={nav} dark={sideDark} />
        <div className="mt-auto space-y-3">
          <div className={`rounded-2xl p-4 ${sideDark ? "bg-white/10" : "bg-bg"}`}>
            <span className="grid size-9 place-items-center rounded-xl bg-accent/15 text-accent"><Icon name="help" /></span>
            <p className="mt-3 text-sm font-semibold">Need help?</p>
            <Link href="/privacy" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent">Privacy &amp; guides <Icon name="arrowRight" size={14} /></Link>
          </div>
          <form action={signOut}>
            <button className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted ${sideDark ? "hover:bg-white/10" : "hover:bg-bg hover:text-ink"}`}>
              <Icon name="logout" size={19} /> Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-h-dvh flex-col lg:pl-64">
        {/* Top bar */}
        <header className={`sticky top-0 z-10 border-b ${app ? "hidden lg:block" : ""} ${head === "light" ? "border-line bg-surface/90 backdrop-blur" : "border-transparent"}`}
          style={{ background: headBg, color: headInk, ["--muted" as string]: headInk ? "rgb(255 255 255 / 0.75)" : undefined }}>
          <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 lg:px-8">
            <div className="lg:hidden"><Logo name={instName} theme={theme} onDark={!!headInk} /></div>
            {theme.header.showDate && (
              <span className={`hidden items-center gap-2 rounded-xl border px-3 py-1.5 text-sm text-muted lg:inline-flex ${headInk ? "border-white/25" : "border-line"}`}>
                <Icon name="calendar" size={16} />{today}
              </span>
            )}
            <div className="ml-auto flex items-center gap-2">
              {choices.length > 1 && (
                <form action={switchInstitution} className="hidden items-center gap-1 md:flex">
                  <select name="institution" defaultValue={current.institution_id ?? ""} aria-label="Institution"
                    className="h-9 rounded-xl border border-line bg-surface px-2 text-sm text-ink">
                    {choices.map((c) => <option key={c.institution_id} value={c.institution_id ?? ""}>{c.institution_name}</option>)}
                  </select>
                  <button className="h-9 rounded-xl border border-line px-3 text-sm hover:opacity-80">Switch</button>
                </form>
              )}
              <Link href="/notifications" className="relative grid size-10 place-items-center rounded-xl hover:bg-black/5" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
                <Icon name="bell" />
                {unread > 0 && <span className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-bad px-1 text-[10px] font-semibold text-white">{unread > 9 ? "9+" : unread}</span>}
              </Link>
              <div className="hidden items-center gap-2 sm:flex">
                <span className="grid size-9 place-items-center rounded-full bg-brand text-sm font-semibold text-brand-ink ring-2 ring-white/40">{(who[0] ?? "?").toUpperCase()}</span>
                <span className="hidden max-w-44 truncate text-sm font-medium xl:block">{who}</span>
              </div>
              <form action={signOut} className="lg:hidden">
                <button className="grid size-10 place-items-center rounded-xl hover:bg-black/5" aria-label="Sign out"><Icon name="logout" /></button>
              </form>
            </div>
          </div>
        </header>

        {theme.announcement.show && theme.announcement.text && (
          <div role="status" className={`px-4 py-2 text-center text-sm font-medium lg:px-8 ${TONE[theme.announcement.tone]}`}>{theme.announcement.text}</div>
        )}

        <main className={`mx-auto w-full max-w-7xl flex-1 px-4 lg:px-8 lg:pb-10 ${app ? "pt-[max(20px,env(safe-area-inset-top))] pb-36 lg:pt-6" : "pt-6 pb-28"}`}>
          {app ? <AppProvider me={{ name: who || "Student", initials, unread, institution: instName }}>{children}</AppProvider> : children}
        </main>

        {theme.footer.show && (theme.footer.text || theme.footer.links.length > 0) && (
          <footer className={`border-t border-line bg-surface px-4 pt-5 ${app ? "pb-36" : "pb-24"} text-sm text-muted lg:px-8 lg:pb-5`}>
            <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
              <span>{theme.footer.text}</span>
              <nav aria-label="Footer" className="flex flex-wrap gap-x-4 gap-y-1">
                {theme.footer.links.map((l) => (
                  <a key={l.url + l.label} href={l.url} className="hover:text-accent" {...(l.url.startsWith("https://") ? { target: "_blank", rel: "noreferrer" } : {})}>{l.label}</a>
                ))}
              </nav>
            </div>
          </footer>
        )}
      </div>

      {app ? <AppTabBar items={nav} center={app.center} /> : <TabBar items={nav} />}
    </div>
  );
}
