"use client";
import { Icon } from "@/components/icons";

/** "Add to my calendar" (.ics download) and "Print / save as PDF". */
export function TimetableActions({ ics, hint }: { ics: string | null; hint?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      {ics && <a href={ics} download className="inline-flex h-11 items-center gap-2 rounded-2xl bg-accent px-4 text-sm font-semibold text-white shadow-[0_8px_20px_color-mix(in_srgb,var(--accent)_30%,transparent)]">
        <Icon name="calendar" size={18} />Add to my calendar
      </a>}
      <button type="button" onClick={() => window.print()} className="inline-flex h-11 items-center gap-2 rounded-2xl bg-surface px-4 text-sm font-semibold shadow-card">
        <Icon name="download" size={18} />Print / save as PDF
      </button>
      {hint && ics && <p className="w-full text-xs text-muted">{hint}</p>}
    </div>
  );
}
