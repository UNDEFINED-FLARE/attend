"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui";
import { searchDirectory, type DirectoryEntry } from "@/lib/sign-in";

/** Search and choose an institution; choosing opens its way in (/login?i=<slug>). */
export function InstitutionPicker({ list, next }: { list: DirectoryEntry[]; next: string }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => searchDirectory(list, q), [list, q]);
  const nextParam = next !== "/dashboard" ? `&next=${encodeURIComponent(next)}` : "";
  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium" htmlFor="inst-search">Your university or college</label>
      <Input id="inst-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, e.g. Venda"
        autoComplete="off" aria-controls="inst-list" />
      <ul id="inst-list" className="max-h-80 space-y-1.5 overflow-y-auto" aria-label="Institutions">
        {shown.map((e) => (
          <li key={e.slug}>
            <Link href={`/login?i=${e.slug}${nextParam}`} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 hover:border-ink">
              {e.logo
                // eslint-disable-next-line @next/next/no-img-element -- the institution's own logo (https, admin-set)
                ? <img src={e.logo} alt="" className="size-10 shrink-0 rounded-xl bg-white object-contain p-1" referrerPolicy="no-referrer" />
                : <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-bg text-sm font-semibold">{(e.short_name ?? e.name).slice(0, 2).toUpperCase()}</span>}
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate font-medium">{e.name}</span>
                <span className="block truncate text-xs text-muted">{[e.short_name, e.campuses?.slice(0, 3).join(", ")].filter(Boolean).join(" · ") || " "}</span>
              </span>
            </Link>
          </li>
        ))}
        {shown.length === 0 && <li className="rounded-2xl bg-bg p-3 text-sm text-muted">No institution matches. Check the spelling, or ask your university whether it uses UniAttend.</li>}
      </ul>
    </div>
  );
}
