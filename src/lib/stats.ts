// Small helpers for dashboards. All inputs are real rows; nothing is invented.

const TZ = "Africa/Johannesburg";

/** ISO timestamp of local midnight (SAST, UTC+2, no DST) `daysAgo` days back. */
export function sastMidnight(daysAgo = 0): string {
  const now = new Date();
  const local = new Date(now.getTime() + 2 * 3600_000);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - 2 * 3600_000 - daysAgo * 86_400_000).toISOString();
}

export const sastHour = (iso: string) => (new Date(iso).getUTCHours() + 2) % 24;
export const sastDay = (iso: string) => new Date(new Date(iso).getTime() + 2 * 3600_000).toISOString().slice(0, 10);
export const dayLabel = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-ZA", { day: "numeric", month: "short", timeZone: TZ });

/** attended / (attended + absent) as a percentage; unresolved records excluded (see module_report). */
export function rate(rows: { status: string }[]): number | null {
  let att = 0, abs = 0;
  for (const r of rows) {
    if (r.status === "present" || r.status === "late") att++;
    else if (r.status === "absent") abs++;
  }
  return att + abs ? Math.round((1000 * att) / (att + abs)) / 10 : null;
}

export function groupBy<T, K extends string>(rows: T[], key: (r: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const r of rows) {
    const k = key(r);
    const arr = m.get(k);
    if (arr) arr.push(r); else m.set(k, [r]);
  }
  return m;
}

export function greeting(): string {
  const h = (new Date().getUTCHours() + 2) % 24;
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export const timeOf = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", timeZone: TZ }) : "—";
