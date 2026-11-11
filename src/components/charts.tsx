// Dependency-free SVG charts, rendered on the server. Each one has a text
// alternative (aria-label / <title>) so the numbers are not locked in a picture.
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";

export type Series = { label: string; color: string; points: number[] };

/** Line chart with a soft area under the first series. */
export function AreaChart({ series, labels, height = 220, unit = "", max: fixedMax }: { series: Series[]; labels: string[]; height?: number; unit?: string; max?: number }) {
  const W = 640, H = height, L = 36, R = 12, T = 12, B = 26;
  const max = Math.max(1, ...series.flatMap((s) => s.points));
  // At least 4 so the five gridlines get distinct whole-number labels.
  const nice = fixedMax ?? niceMax(Math.max(4, max));
  const n = Math.max(2, labels.length);
  const x = (i: number) => L + (i * (W - L - R)) / (n - 1);
  const y = (v: number) => T + (H - T - B) * (1 - v / nice);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(nice * f));
  const every = Math.ceil(labels.length / 8);
  const summary = series.map((s) => `${s.label}: ${s.points.at(-1) ?? 0}${unit}`).join(", ");
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-muted">
        {series.map((s) => <span key={s.label} className="inline-flex items-center gap-1.5"><i className="h-0.5 w-4 rounded" style={{ background: s.color }} />{s.label}</span>)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Chart. Latest values: ${summary}`}>
        <defs>
          <linearGradient id="area-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={series[0]?.color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={series[0]?.color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray={t ? "3 4" : undefined} />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{t}</text>
          </g>
        ))}
        {labels.map((lab, i) => i % every === 0 && (
          <text key={lab + i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--muted)">{lab}</text>
        ))}
        {series[0] && series[0].points.length > 1 && (
          <path d={`${path(series[0].points, x, y)} L ${x(series[0].points.length - 1)} ${y(0)} L ${x(0)} ${y(0)} Z`} fill="url(#area-fill)" />
        )}
        {series.map((s) => s.points.length > 1 && (
          <g key={s.label}>
            <path d={path(s.points, x, y)} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {s.points.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r="3" fill="#fff" stroke={s.color} strokeWidth="2"><title>{`${labels[i]}: ${v}${unit} ${s.label.toLowerCase()}`}</title></circle>
            ))}
          </g>
        ))}
      </svg>
    </div>
  );
}

function path(p: number[], x: (i: number) => number, y: (v: number) => number) {
  return p.map((v, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
}

function niceMax(v: number) {
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v) ?? v;
}

/** Donut with a centred figure. */
export function Donut({ segments, center, sub, size = 168 }: { segments: { label: string; value: number; color: string }[]; center: ReactNode; sub?: string; size?: number }) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  const r = 42, c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" className="size-full -rotate-90" role="img"
          aria-label={segments.map((s) => `${s.label} ${s.value}`).join(", ")}>
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--line)" strokeWidth="12" />
          {total > 0 && segments.map((s) => {
            const len = (s.value / total) * c;
            const el = <circle key={s.label} cx="50" cy="50" r={r} fill="none" stroke={s.color} strokeWidth="12"
              strokeDasharray={`${Math.max(0, len - 1.2)} ${c}`} strokeDashoffset={-offset} />;
            offset += len;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-2xl font-semibold tabular-nums">{center}</span>
          {sub && <span className="text-xs text-muted">{sub}</span>}
        </div>
      </div>
      <ul className="space-y-2 text-sm">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <i className="size-2.5 rounded-full" style={{ background: s.color }} />
            <span className="text-muted">{s.label}</span>
            <b className="ml-auto pl-4 tabular-nums">{s.value}</b>
            <span className="w-10 text-right text-xs text-muted">{total ? Math.round((100 * s.value) / total) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Progress ring, e.g. a student's overall attendance. */
export function Ring({ value, size = 96, stroke = 10, color = "#fff", track = "rgb(255 255 255 / 0.2)", children }: {
  value: number | null; size?: number; stroke?: number; color?: string; track?: string; children?: ReactNode;
}) {
  const r = 50 - stroke / 2, c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" stroke={track} strokeWidth={stroke} />
        {value != null && <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} />}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

/** Thin bar for tables. */
export function Bar({ value, color }: { value: number | null; color?: string }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  const c = color ?? (value == null ? "var(--line)" : v >= 80 ? "var(--ok)" : v >= 60 ? "var(--warn)" : "var(--bad)");
  return (
    <div className="h-1.5 w-full min-w-16 overflow-hidden rounded-full bg-line" role="presentation">
      <div className="h-full rounded-full" style={{ width: `${v}%`, background: c }} />
    </div>
  );
}

const TONES = {
  blue: "bg-info/10 text-info", green: "bg-ok/10 text-ok", red: "bg-bad/10 text-bad",
  amber: "bg-warn/10 text-warn", violet: "bg-violet/10 text-violet", navy: "bg-brand/10 text-brand",
} as const;

/** Stat tile: what it counts, then the number in big sign numerals, then context. */
export function StatTile({ icon, tone, label, value, hint }: { icon: IconName; tone: keyof typeof TONES; label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-2xl bg-surface p-5 shadow-card">
      <div className="flex items-center gap-2.5">
        <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${TONES[tone]}`}><Icon name={icon} size={19} /></span>
        <p className="text-sm font-semibold text-muted">{label}</p>
      </div>
      <p className="mt-3 font-display text-[40px] font-bold leading-none tabular-nums tracking-tight">{value}</p>
      {hint && <p className="mt-2 text-sm text-muted">{hint}</p>}
    </div>
  );
}
