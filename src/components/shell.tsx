import Link from "next/link";
import type { ReactNode } from "react";
import { signOut, switchInstitution } from "@/app/actions";
import { Icon } from "@/components/icons";
import { SideNav, TabBar, type NavItem } from "@/components/nav";
import type { RoleRow } from "@/lib/auth";

export type { NavItem };

function Logo({ name }: { name: string }) {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5">
      <span className="grid size-9 place-items-center rounded-xl bg-brand text-brand-ink"><Icon name="check" size={20} strokeWidth={2.6} /></span>
      <span className="leading-tight">
        <span className="block text-[15px] font-semibold">UniAttend</span>
        <span className="block max-w-40 truncate text-xs text-muted">{name}</span>
      </span>
    </Link>
  );
}

export function Shell({ nav, children, current, choices, area, user, unread = 0 }: {
  nav: NavItem[];
  children: ReactNode;
  current: RoleRow;
  choices: RoleRow[];
  area: string;
  user: { email?: string | null; name?: string | null };
  unread?: number;
}) {
  const brand = current.brand_primary ?? "#0b2545";
  const instName = current.institution_name ?? "Platform";
  const who = user.name || user.email || "";
  const today = new Date().toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Johannesburg" });

  return (
    <div style={{ ["--brand" as string]: brand }} className="min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-line bg-surface px-4 py-5 lg:flex">
        <Logo name={instName} />
        <p className="mt-8 mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted">{area}</p>
        <SideNav items={nav} />
        <div className="mt-auto space-y-3">
          <div className="rounded-2xl bg-bg p-4">
            <span className="grid size-9 place-items-center rounded-xl bg-accent/10 text-accent"><Icon name="help" /></span>
            <p className="mt-3 text-sm font-semibold">Need help?</p>
            <Link href="/privacy" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent">Privacy &amp; guides <Icon name="arrowRight" size={14} /></Link>
          </div>
          <form action={signOut}>
            <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted hover:bg-bg hover:text-ink">
              <Icon name="logout" size={19} /> Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="lg:pl-64">
        {/* Top bar */}
        <header className="sticky top-0 z-10 border-b border-line bg-surface/90 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 lg:px-8">
            <div className="lg:hidden"><Logo name={instName} /></div>
            <span className="hidden items-center gap-2 rounded-xl border border-line px-3 py-1.5 text-sm text-muted lg:inline-flex">
              <Icon name="calendar" size={16} />{today}
            </span>
            <div className="ml-auto flex items-center gap-2">
              {choices.length > 1 && (
                <form action={switchInstitution} className="hidden items-center gap-1 md:flex">
                  <select name="institution" defaultValue={current.institution_id ?? ""} aria-label="Institution"
                    className="h-9 rounded-xl border border-line bg-surface px-2 text-sm">
                    {choices.map((c) => <option key={c.institution_id} value={c.institution_id ?? ""}>{c.institution_name}</option>)}
                  </select>
                  <button className="h-9 rounded-xl border border-line px-3 text-sm hover:bg-bg">Switch</button>
                </form>
              )}
              <Link href="/notifications" className="relative grid size-10 place-items-center rounded-xl text-muted hover:bg-bg hover:text-ink" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
                <Icon name="bell" />
                {unread > 0 && <span className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-bad px-1 text-[10px] font-semibold text-white">{unread > 9 ? "9+" : unread}</span>}
              </Link>
              <div className="hidden items-center gap-2 sm:flex">
                <span className="grid size-9 place-items-center rounded-full bg-brand text-sm font-semibold text-brand-ink">{(who[0] ?? "?").toUpperCase()}</span>
                <span className="hidden max-w-44 truncate text-sm font-medium xl:block">{who}</span>
              </div>
              <form action={signOut} className="lg:hidden">
                <button className="grid size-10 place-items-center rounded-xl text-muted hover:bg-bg" aria-label="Sign out"><Icon name="logout" /></button>
              </form>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 pt-6 pb-28 lg:px-8 lg:pb-10">{children}</main>
      </div>

      <TabBar items={nav} />
    </div>
  );
}
