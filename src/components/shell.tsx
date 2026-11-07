import Link from "next/link";
import type { ReactNode } from "react";
import { signOut, switchInstitution } from "@/app/actions";
import type { RoleRow } from "@/lib/auth";

export function Shell({
  nav, children, current, choices, area,
}: {
  nav: { href: string; label: string }[];
  children: ReactNode;
  current: RoleRow;
  choices: RoleRow[];
  area: string;
}) {
  const brand = current.brand_primary ?? "#0b2545";
  return (
    <div style={{ ["--brand" as string]: brand }} className="min-h-dvh">
      <header className="sticky top-0 z-10 bg-brand text-brand-ink">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 h-14">
          <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
            <svg width="22" height="22" viewBox="0 0 64 64" aria-hidden><path d="M18 33l9 9 19-20" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" /></svg>
            UniAttend
          </Link>
          <span className="hidden text-sm opacity-80 sm:inline">{current.institution_name ?? "Platform"} · {area}</span>
          <div className="ml-auto flex items-center gap-2">
            {choices.length > 1 && (
              <form action={switchInstitution} className="hidden sm:block">
                <select name="institution" defaultValue={current.institution_id ?? ""}
                  className="h-8 rounded-md bg-white/10 px-2 text-sm" aria-label="Institution">
                  {choices.map((c) => <option key={c.institution_id} value={c.institution_id ?? ""} className="text-ink">{c.institution_name}</option>)}
                </select>
                <button className="ml-1 h-8 rounded-md bg-white/10 px-2 text-sm">Switch</button>
              </form>
            )}
            <Link href="/notifications" className="rounded-md px-2 py-1 text-sm hover:bg-white/10">Notifications</Link>
            <form action={signOut}><button className="rounded-md px-2 py-1 text-sm hover:bg-white/10">Sign out</button></form>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2 pb-2" aria-label="Section">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="whitespace-nowrap rounded-md px-3 py-1.5 text-sm opacity-90 hover:bg-white/10 hover:opacity-100">
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
