"use client";
// The student app's phone-style chrome: a big page title with the avatar beside it,
// and a floating tab bar with the scanner raised in the middle. Desktop keeps the
// sidebar and top bar from the shell; these pieces adapt to it.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { signOut } from "@/app/actions";
import { Icon } from "@/components/icons";
import type { NavItem } from "@/components/nav";

type Me = { name: string; initials: string; unread: number; institution: string };
const MeContext = createContext<Me | null>(null);

export function AppProvider({ me, children }: { me: Me; children: ReactNode }) {
  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}

/** Big title (left) and, on phones, the notification bell and avatar menu (right). */
export function AppTitle({ title, eyebrow, sub, action }: { title: string; eyebrow?: ReactNode; sub?: ReactNode; action?: ReactNode }) {
  const me = useContext(MeContext);
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

function Bell({ unread }: { unread: number }) {
  return (
    <Link href="/notifications" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
      className="relative grid size-11 place-items-center rounded-full bg-surface text-ink shadow-card">
      <Icon name="bell" size={20} />
      {unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full border-2 border-bg bg-bad px-1 text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}
    </Link>
  );
}

function AvatarMenu({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    // Escape closes the menu too, as keyboard and screen-reader users expect.
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("click", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("click", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="true" aria-label="Account"
        className="grid size-11 place-items-center rounded-full bg-brand text-sm font-semibold text-brand-ink">
        {me.initials}
      </button>
      {open && (
        <div className="absolute right-0 top-14 z-40 w-64 overflow-hidden rounded-2xl bg-surface shadow-[0_12px_40px_rgb(15_27_45/0.18)]">
          <div className="border-b border-line p-4">
            <p className="truncate font-semibold">{me.name}</p>
            <p className="truncate text-xs text-muted">{me.institution}</p>
          </div>
          <nav className="p-2 text-sm">
            <Link href="/notifications" className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-bg"><Icon name="bell" size={18} />Notifications</Link>
            <Link href="/student/history" className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-bg"><Icon name="flag" size={18} />Disputes</Link>
            <Link href="/settings" className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-bg"><Icon name="lock" size={18} />Security &amp; app lock</Link>
            <Link href="/privacy" className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-bg"><Icon name="shield" size={18} />Privacy</Link>
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
 * Bottom navigation bar the way Android draws it (Material 3): full width, every destination
 * labelled (an icon on its own is a guess), a soft pill behind the current one. Check in sits
 * with the other tabs; the home screen's "Attendance is open" card is the main way in.
 */
export function AppTabBar({ items }: { items: NavItem[]; center?: string }) {
  const path = usePathname();
  const active = items.filter((i) => path === i.href || path.startsWith(i.href + "/")).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface print:hidden pb-[env(safe-area-inset-bottom)] lg:hidden">
      <ul className="mx-auto flex max-w-xl">
        {items.map((i) => {
          const on = i.href === active;
          return (
            <li key={i.href} className="min-w-0 flex-1">
              <Link href={i.href} aria-current={on ? "page" : undefined}
                className="flex flex-col items-center gap-1 px-1 pt-2.5 pb-3 text-xs">
                <span className={`grid h-8 w-14 place-items-center rounded-full transition-colors ${on ? "bg-brand/12 text-brand" : "text-muted"}`}>
                  <Icon name={i.icon} size={22} strokeWidth={on ? 2.2 : 1.8} />
                </span>
                <span className={`max-w-full truncate ${on ? "font-semibold text-ink" : "font-medium text-muted"}`}>{i.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
