"use client";
import { useState } from "react";
import { Icon } from "@/components/icons";

export type TrendSeries = { key: string; label: string; badge: string; color: string; points: { label: string; att: number; tot: number }[] };

const W = 320, H = 150, PAD = { l: 12, r: 12, t: 34, b: 30 };

/** Weekly attendance as a line, per module or overall; tap a point for its numbers. */
export function TrendCard({ title, series }: { title: string; series: TrendSeries[] }) {
  const [key, setKey] = useState(series[0]?.key ?? "");
  const s = series.find((x) => x.key === key) ?? series[0];
  const pts = s?.points ?? [];
  const lastWithData = pts.map((p) => p.tot > 0).lastIndexOf(true);
  const [sel, setSel] = useState<number | null>(null);
  const at = sel ?? (lastWithData >= 0 ? lastWithData : pts.length - 1);

  const x = (i: number) => PAD.l + (pts.length <= 1 ? (W - PAD.l - PAD.r) / 2 : (i * (W - PAD.l - PAD.r)) / (pts.length - 1));
  const rate = (p: { att: number; tot: number }) => (p.tot ? p.att / p.tot : null);
  const y = (r: number) => PAD.t + (1 - r) * (H - PAD.t - PAD.b);
  const xy = pts.map((p, i) => ({ i, r: rate(p) })).filter((p): p is { i: number; r: number } => p.r != null);
  const line = xy.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.r).toFixed(1)}`).join(" ");
  const area = xy.length > 1 ? `${line} L${x(xy[xy.length - 1].i)},${H - PAD.b} L${x(xy[0].i)},${H - PAD.b} Z` : "";
  const cur = pts[at], prev = pts.slice(0, at).reverse().find((p) => p.tot > 0);
  const diff = cur && prev && cur.tot && prev.tot ? Math.round(100 * (cur.att / cur.tot - prev.att / prev.tot)) : null;
  const tipW = diff != null ? 96 : 52;
  const tipX = cur ? Math.min(W - tipW / 2 - 2, Math.max(tipW / 2 + 2, x(at))) : 0;

  return (
    <section className="min-w-0 rounded-3xl bg-surface p-5 shadow-card">
      <h2 className="text-sm font-semibold text-muted">{title}</h2>
      <label className="relative mt-3 inline-flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl text-white" style={{ background: s?.color }}>
          {s?.key === "all" ? <Icon name="chart" size={20} /> : <span className="text-xs font-bold">{s?.badge}</span>}
        </span>
        <span className="text-lg font-bold">{s?.label}</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="text-muted" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
        <select value={key} onChange={(e) => { setKey(e.target.value); setSel(null); }} aria-label="Module"
          className="absolute inset-0 cursor-pointer opacity-0">
          {series.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      </label>

      {xy.length === 0 ? (
        <p className="mt-6 rounded-2xl bg-bg p-6 text-center text-sm text-muted">Your weekly attendance appears here after your first closed class.</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full overflow-visible" role="img" aria-label={`${s?.label} weekly attendance`}>
          <defs>
            <linearGradient id="trendFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--accent)" stopOpacity="0.18" />
              <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75, 1].map((g) => <line key={g} x1={PAD.l} x2={W - PAD.r} y1={y(g)} y2={y(g)} stroke="var(--line)" strokeDasharray="3 4" />)}
          {area && <path d={area} fill="url(#trendFill)" />}
          <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {xy.map((p) => (
            <g key={p.i} onClick={() => setSel(p.i)} className="cursor-pointer">
              <circle cx={x(p.i)} cy={y(p.r)} r="12" fill="transparent" />
              <circle cx={x(p.i)} cy={y(p.r)} r={p.i === at ? 6 : 4.5} fill="var(--surface)" stroke="var(--accent)" strokeWidth={p.i === at ? 3 : 2.5} />
            </g>
          ))}
          {cur && cur.tot > 0 && (
            <g>
              <line x1={x(at)} x2={x(at)} y1={y(cur.att / cur.tot) + 8} y2={H - PAD.b} stroke="var(--accent)" strokeOpacity="0.25" />
              <rect x={tipX - tipW / 2} y={Math.max(0, y(cur.att / cur.tot) - 34)} width={tipW} height="24" rx="8" fill="var(--surface)" stroke="var(--line)" />
              <text x={tipX} y={Math.max(0, y(cur.att / cur.tot) - 34) + 16} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--ink)">
                {cur.att}/{cur.tot}
                {diff != null && <tspan fill={diff >= 0 ? "var(--ok)" : "var(--bad)"} fontWeight="600"> ({diff >= 0 ? "+" : ""}{diff}%)</tspan>}
              </text>
            </g>
          )}
          {pts.map((p, i) => (
            <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fontWeight={i === at ? 700 : 500} fill={i === at ? "var(--ink)" : "var(--muted)"}>{p.label}</text>
          ))}
        </svg>
      )}
    </section>
  );
}
