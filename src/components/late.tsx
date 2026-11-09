// Late-arrival pieces shared by the student check-in result and the lecturer register.

const t = (iso: string) => new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });

/** "17 min late", coloured by how late: a few minutes, up to half an hour, more. */
export function LateChip({ minutes, className = "" }: { minutes: number | null | undefined; className?: string }) {
  if (minutes == null) return null;
  const tone = minutes <= 10 ? "bg-muted/15 text-muted" : minutes <= 30 ? "bg-warn/15 text-warn" : "bg-bad/15 text-bad";
  const label = minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min late` : `${minutes} min late`;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${tone} ${className}`}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
      {label}
    </span>
  );
}

/**
 * Class opened → grace period ended → arrived. The on-time window is green, the
 * time after the grace period is grey, and the dot marks when the live QR and the
 * phone's location put the student in the venue.
 */
export function ArrivalTimeline({ opensAt, lateAfter, arrivedAt }: { opensAt: string; lateAfter: string; arrivedAt: string }) {
  const a = Date.parse(opensAt), g = Date.parse(lateAfter), x = Date.parse(arrivedAt);
  if (![a, g, x].every(Number.isFinite) || g < a) return null;
  // Leave a little track after the arrival so the dot is never on the edge.
  const end = Math.max(x, g) + Math.max(60_000, (Math.max(x, g) - a) * 0.12);
  const pct = (v: number) => `${(100 * (v - a)) / (end - a)}%`;
  return (
    <div className="pt-1" aria-label={`Class opened ${t(opensAt)}, grace period ended ${t(lateAfter)}, arrived ${t(arrivedAt)}`}>
      <div className="relative h-2 rounded-full bg-muted/20">
        <div className="absolute inset-y-0 left-0 rounded-l-full bg-ok/60" style={{ width: pct(g) }} />
        {x > g && <div className="absolute inset-y-0 bg-muted/45" style={{ left: pct(g), width: `calc(${pct(x)} - ${pct(g)})` }} />}
        <span className="absolute top-1/2 h-4 w-0.5 -translate-y-1/2 bg-ink/40" style={{ left: pct(g) }} aria-hidden />
        <span className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-ink shadow" style={{ left: pct(x) }} aria-hidden />
      </div>
      <div className="relative mt-2 h-8 text-[11px] leading-tight text-muted">
        <span className="absolute left-0">Opened<br /><b className="text-ink">{t(opensAt)}</b></span>
        <span className="absolute -translate-x-1/2 text-center" style={{ left: pct(g) }}>Grace ended<br /><b className="text-ink">{t(lateAfter)}</b></span>
        <span className="absolute right-0 text-right">You arrived<br /><b className="text-ink">{t(arrivedAt)}</b></span>
      </div>
    </div>
  );
}
