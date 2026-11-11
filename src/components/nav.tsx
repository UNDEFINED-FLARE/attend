"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/icons";

export type NavItem = { href: string; label: string; icon: IconName; mobile?: boolean };

// The longest matching prefix wins, so /lecturer/modules/x highlights
// "My modules" rather than every item that starts with /lecturer.
function useActive(items: NavItem[]) {
  const path = usePathname();
  const matches = items.filter((i) => path === i.href || path.startsWith(i.href + "/"));
  return matches.sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

export function SideNav({ items, dark = false }: { items: NavItem[]; dark?: boolean }) {
  const active = useActive(items);
  return (
    <nav className="space-y-1" aria-label="Main">
      {items.map((i) => {
        const on = i.href === active;
        return (
          <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined}
            // The current page is lit like a sign: a solid navy plate (a yellow edge on dark sidebars).
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${on ? (dark ? "bg-white/15 text-white shadow-[inset_3px_0_0_var(--signal)]" : "bg-brand text-brand-ink") : dark ? "text-muted hover:bg-white/10" : "text-muted hover:bg-bg hover:text-ink"}`}>
            <Icon name={i.icon} size={19} />
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function TabBar({ items }: { items: NavItem[] }) {
  const tabs = items.filter((i) => i.mobile !== false).slice(0, 5);
  const active = useActive(items);
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 print:hidden pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <ul className="mx-auto flex max-w-md justify-around">
        {tabs.map((i) => {
          const on = i.href === active;
          return (
            <li key={i.href} className="flex-1">
              <Link href={i.href} aria-current={on ? "page" : undefined}
                className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold ${on ? "text-ink" : "text-muted"}`}>
                <span className={`grid h-8 w-14 place-items-center rounded-full ${on ? "bg-brand text-brand-ink" : ""}`}><Icon name={i.icon} size={20} /></span>
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
