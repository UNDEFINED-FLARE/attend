import { LEGAL } from "@/lib/legal";

/** "UniAttend is a product of …": the operating company, as the legal pages and footer show it. */
export function CompanyMark({ className = "" }: { className?: string }) {
  if (!LEGAL.company) return null;
  return (
    <p className={`flex flex-wrap items-center gap-2 text-xs text-muted ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- small static logo */}
      <img src="/webbex-logo.svg" alt="" width={16} height={16} className="size-4 dark:invert" />
      <span>UniAttend is a product of <b className="font-semibold text-ink">{LEGAL.company}</b>{LEGAL.registration && <> · Reg. {LEGAL.registration}</>}</span>
    </p>
  );
}
