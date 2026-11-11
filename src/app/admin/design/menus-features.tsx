"use client";
import { useState } from "react";
import { Icon } from "@/components/icons";
import { MENU_ROLE_LABEL, MENUS, type MenuRole } from "@/lib/nav-config";
import { FEATURES, type Theme } from "@/lib/theme";

type Menus = Theme["menus"];

/** Features: switch optional parts of UniAttend on or off for the whole institution. */
export function FeatureSwitches({ value, onChange }: { value: Theme["features"]; onChange: (v: Theme["features"]) => void }) {
  return (
    <ul className="space-y-1.5">
      {(Object.keys(FEATURES) as (keyof typeof FEATURES)[]).map((k) => (
        <li key={k}>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-2.5">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{FEATURES[k][0]}</span>
              <span className="block text-[11px] text-muted">{FEATURES[k][1]}</span>
            </span>
            <input type="checkbox" className="peer sr-only" checked={value[k]} onChange={(e) => onChange({ ...value, [k]: e.target.checked })} />
            <span aria-hidden className="relative mt-0.5 h-6 w-10 shrink-0 rounded-full bg-line transition peer-checked:bg-brand after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-4" />
          </label>
        </li>
      ))}
    </ul>
  );
}

/** Menus: rename, hide and reorder each role's menu. Locked items can be renamed and moved but not hidden. */
export function MenuEditor({ value, features, onChange }: { value: Menus; features: Theme["features"]; onChange: (v: Menus) => void }) {
  const [role, setRole] = useState<MenuRole>("student");
  const defs = MENUS[role];
  // The saved list, completed with any items not saved yet.
  const items = [
    ...value[role].filter((s) => defs.some((d) => d.href === s.href)),
    ...defs.filter((d) => !value[role].some((s) => s.href === d.href)).map((d) => ({ href: d.href, label: d.label, show: true })),
  ];
  const put = (next: typeof items) => onChange({ ...value, [role]: next });
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const n = [...items]; [n[i], n[j]] = [n[j], n[i]]; put(n);
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-1 rounded-xl bg-bg p-1" role="tablist">
        {(Object.keys(MENUS) as MenuRole[]).map((r) => (
          <button key={r} type="button" role="tab" aria-selected={role === r} onClick={() => setRole(r)}
            className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium ${role === r ? "bg-surface shadow-sm" : "text-muted"}`}>{MENU_ROLE_LABEL[r]}</button>
        ))}
      </div>
      <ol className="space-y-1.5">
        {items.map((it, i) => {
          const def = defs.find((d) => d.href === it.href)!;
          const off = def.feature && !features[def.feature];
          return (
            <li key={it.href} className={`flex items-center gap-2 rounded-xl border border-line p-2 ${it.show && !off ? "" : "opacity-55"}`}>
              <span className="flex flex-col">
                <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className="text-muted disabled:opacity-30"><Icon name="arrowRight" size={14} className="-rotate-90" /></button>
                <button type="button" aria-label="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)} className="text-muted disabled:opacity-30"><Icon name="arrowRight" size={14} className="rotate-90" /></button>
              </span>
              <Icon name={def.icon} size={16} className="shrink-0 text-muted" />
              <input value={it.label} maxLength={30} placeholder={def.label} aria-label={`Name for ${def.label}`}
                onChange={(e) => put(items.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))}
                className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-sm" />
              {def.locked
                ? <span className="w-14 text-center text-[10px] text-muted" title="Always shown so nobody is locked out">always</span>
                : <label className="flex w-14 items-center justify-center gap-1 text-xs">
                    <input type="checkbox" checked={it.show} onChange={(e) => put(items.map((x, k) => (k === i ? { ...x, show: e.target.checked } : x)))} className="size-4" />Show
                  </label>}
            </li>
          );
        })}
      </ol>
      <p className="text-[11px] text-muted">
        On phones the first five items show in the bottom bar{role === "student" ? "; Check in always sits raised in the middle" : ""}. Items for features that are switched off are hidden automatically.
      </p>
      <button type="button" onClick={() => put(defs.map((d) => ({ href: d.href, label: d.label, show: true })))} className="text-xs font-medium text-accent">Reset this menu</button>
    </div>
  );
}
