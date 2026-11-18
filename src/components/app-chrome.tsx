"use client";
// The student app's phone-style chrome: a big page title with the avatar beside it,
// and a floating tab bar with the scanner raised in the middle. Desktop keeps the
// sidebar and top bar from the shell; these pieces adapt to it.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { signOut } from "@/app/actions";
import { Icon } from "@/components/icons";
import { LookButton } from "@/components/look-button";
import type { NavItem } from "@/components/nav";
import type { Look } from "@/lib/look";

type Me = { name: string; initials: string; unread: number; institution: string; look?: Look };
const MeContext = createContext<Me | null>(null);

export function AppProvider({ me, children }: { me: Me; children: ReactNode }) {
  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}

/** Big title (left) and, on phones, the notification bell and avatar menu (right). */
export function AppTitle({ title, eyebrow, sub, action }: { title: string; eyebrow?: ReactNode; sub?: ReactNode; action?: ReactNode }) {
  const me = useContext(MeContext);
  // Game look: the same top bar as the game home, with the initials badge (account menu) on the left.
  if (me?.look === "game") {
    return (
      <div className="mb-6 flex items-center gap-3">
        <div className="lg:hidden print:hidden"><AvatarMenu me={me} game /></div>
        <div className="min-w-0 flex-1">
          {eyebrow && <p className="truncate text-xs font-medium text-muted">{eyebrow}</p>}
          <h1 className="truncate text-[22px] font-bold leading-tight tracking-tight">{title}</h1>
          {sub && <p className="mt-0.5 text-sm text-muted">{sub}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {action}
          <div className="lg:hidden print:hidden"><Bell unread={me.unread} game /></div>
        </div>
      </div>
    );
  }
  return (
    <div className="mb-6 flex items-start justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <p className="text-sm font-medium text-muted">{eyebrow}</p>}
        <h1 className="truncate text-[28px] font-bold leading-tight tracking-tight sm:text-[32px]">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-1">
        {action}
        {me && <div className="flex items-center gap-2 lg:hidden print:hidden"><Bell unread={me.unread} /><AvatarMenu me={me} /></div>}
      </div>
    </div>
  );
}

function Bell({ unread, game = false }: { unread: number; game?: boolean }) {
  return (
    <Link href="/notifications" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
      className={game ? "g-icon-btn" : "relative grid size-11 place-items-center rounded-2xl bg-surface text-ink shadow-card"}>
      <Icon name="bell" size={20} strokeWidth={game ? 2.2 : undefined} />
      {unread > 0 && <span className="absolute -right-1.5 -top-1.5 grid min-w-5 place-items-center rounded-full border-2 border-bg bg-bad px-1 text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}
    </Link>
  );
}

function AvatarMenu({ me, game = false }: { me: Me; game?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Account"
        className={game ? "g-avatar" : "grid size-11 place-items-center rounded-full bg-gradient-to-br from-accent to-brand text-sm font-bold text-white shadow-card ring-[3px] ring-surface"}>
        {me.initials}
      </button>
      {open && (
        <div className={`absolute ${game ? "left-0 top-16" : "right-0 top-14"} z-40 w-64 overflow-hidden rounded-2xl bg-surface text-ink shadow-[0_12px_40px_rgb(15_27_45/0.18)]`}>
          <div className="border-b border-line p-4">
            <p className="truncate font-semibold">{me.name}</p>
            <p className="truncate text-xs text-muted">{me.institution}</p>
          </div>
          <nav className="p-2 text-sm">
            <Link href="/notifications" className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-bg"><Icon name="bell" size={18} />Notifications</Link>
            <Link href="/student/history" className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-bg"><Icon name="flag" size={18} />Disputes</Link>
            <Link href="/settings" className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-bg"><Icon name="lock" size={18} />Security &amp; app lock</Link>
            <Link href="/privacy" className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-bg"><Icon name="shield" size={18} />Privacy</Link>
            <LookButton to={me.look === "game" ? "simple" : "game"} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-bg disabled:opacity-60">
              <Icon name="play" size={18} />{me.look === "game" ? "Simple look" : "Game look"}
            </LookButton>
            <form action={signOut}>
              <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-bad hover:bg-bad/5"><Icon name="logout" size={18} />Sign out</button>
            </form>
          </nav>
        </div>
      )}
    </div>
  );
}

/**
 * Game look (lib/look.ts): the crest (account menu) on the left, the student's name over an
 * attendance bar, and the bell. On desktop the shell's top bar already has the bell and account.
 */
export function GameTopBar({ name, percent }: { name: string; percent: number | null }) {
  const me = useContext(MeContext);
  const v = Math.max(0, Math.min(100, percent ?? 0));
  return (
    <header className="flex items-center gap-3">
      {me && <div className="lg:hidden"><AvatarMenu me={me} game /></div>}
      {me && <span className="g-avatar hidden lg:grid" aria-hidden>{me.initials}</span>}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="truncate text-[19px] font-bold leading-tight tracking-tight">{name}</h1>
          <span className="g-num shrink-0 text-[13px] font-semibold text-[var(--g-muted)]">{percent == null ? "No classes yet" : `${Math.round(percent)}% attended`}</span>
        </div>
        <div className="g-xp mt-2" role="meter" aria-label="Attendance" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
          <span className="g-xp-fill" style={{ width: `${v}%` }} />
        </div>
      </div>
      {me && <div className="lg:hidden"><Bell unread={me.unread} game /></div>}
    </header>
  );
}

/**
 * Game look's bottom bar: a row of chunky tiles. The open tab grows and lifts, with its name in
 * outlined type; the scanner's tile is gold.
 */
export function GameTabBar({ items, center }: { items: NavItem[]; center: string }) {
  const path = usePathname();
  const active = items.filter((i) => path === i.href || path.startsWith(i.href + "/")).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav aria-label="Main" className="g-tabbar fixed inset-x-0 bottom-0 z-30 px-4 pb-[max(12px,env(safe-area-inset-bottom))] print:hidden lg:hidden">
      <ul className="g-tabbar-bar mx-auto flex max-w-md items-end px-1.5 pt-2 pb-1.5">
        {items.map((i) => {
          const on = i.href === active, mid = i.href === center;
          return (
            <li key={i.href} className={`flex basis-0 justify-center transition-[flex-grow] duration-200 ${on ? "grow-[1.5]" : "grow"}`}>
              <Link href={i.href} aria-current={on ? "page" : undefined} className={`g-tab ${mid ? "g-tab-mid" : ""} ${on ? "g-tab-on" : ""}`}>
                <span className="g-tab-tile"><Icon name={mid ? "scan" : i.icon} size={on ? 26 : 22} strokeWidth={on || mid ? 2.3 : 1.9} /></span>
                <span className="g-tab-label">{i.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Floating bottom bar; the scanner sits raised in the middle. */
export function AppTabBar({ items, center }: { items: NavItem[]; center: string }) {
  const path = usePathname();
  const active = items.filter((i) => path === i.href || path.startsWith(i.href + "/")).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 px-4 print:hidden pb-[max(12px,env(safe-area-inset-bottom))] lg:hidden">
      <ul className="mx-auto flex max-w-md items-center justify-around rounded-[28px] bg-surface px-2 py-2 shadow-[0_10px_40px_rgb(15_27_45/0.14)]">
        {items.map((i) => {
          const on = i.href === active;
          if (i.href === center) {
            return (
              <li key={i.href} className="-mt-9">
                <Link href={i.href} aria-label={i.label} aria-current={on ? "page" : undefined}
                  className="grid size-16 place-items-center rounded-full bg-accent text-white shadow-[0_10px_24px_color-mix(in_srgb,var(--accent)_45%,transparent)] ring-[6px] ring-bg transition active:scale-95">
                  <Icon name="scan" size={28} strokeWidth={2.2} />
                </Link>
              </li>
            );
          }
          return (
            <li key={i.href}>
              <Link href={i.href} aria-current={on ? "page" : undefined} aria-label={i.label}
                className={`flex flex-col items-center gap-1 rounded-2xl px-3 py-1.5 text-[10px] font-semibold transition ${on ? "text-accent" : "text-muted"}`}>
                <Icon name={i.icon} size={22} strokeWidth={on ? 2.3 : 1.8} />
                <span className={on ? "" : "opacity-0"}>{i.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
