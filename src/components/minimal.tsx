import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";

// The minimal dashboard kit: grayscale first, structure from size, weight and space,
// not colour. White panels with a hairline border and generous rounding, one dark
// panel for the single thing that matters most, no shadows or gradients. Colours come
// from the institution's theme (default: near-black on off-white), so a university's
// own brand still applies.

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx("rounded-[20px] border border-line bg-surface p-5", className)}>{children}</section>;
}

/** The one dark panel on a screen: what to do now. */
export function FocusPanel({ eyebrow, live = false, title, lines, action, aside }: {
  eyebrow: string; live?: boolean; title: string; lines: string[]; action?: { href: string; label: string; icon?: IconName }; aside?: ReactNode;
}) {
  return (
    <section className="flex items-center gap-4 rounded-[24px] bg-brand p-5 text-brand-ink">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] opacity-70">
          {live && <span className="size-1.5 animate-pulse rounded-full bg-current" />}{eyebrow}
        </p>
        <p className="mt-2 truncate text-xl font-bold tracking-tight">{title}</p>
        {lines.map((l) => <p key={l} className="truncate text-sm opacity-75">{l}</p>)}
        {action && (
          <Link href={action.href} className="mt-4 inline-flex h-11 items-center gap-2 rounded-[14px] bg-surface px-4 text-sm font-semibold text-ink transition active:scale-[0.98]">
            {action.icon && <Icon name={action.icon} size={18} />}{action.label}
          </Link>
        )}
      </div>
      {aside}
    </section>
  );
}

/** A quiet panel in the same place when there is nothing urgent. */
export function CalmPanel({ eyebrow, title, lines, action }: { eyebrow: string; title: string; lines: string[]; action?: { href: string; label: string; icon?: IconName } }) {
  return (
    <Panel>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{eyebrow}</p>
      <p className="mt-2 truncate text-xl font-bold tracking-tight">{title}</p>
      {lines.map((l) => <p key={l} className="truncate text-sm text-muted">{l}</p>)}
      {action && (
        <Link href={action.href} className="mt-4 inline-flex h-11 items-center gap-2 rounded-[14px] border border-line px-4 text-sm font-semibold transition hover:bg-bg active:scale-[0.98]">
          {action.icon && <Icon name={action.icon} size={18} />}{action.label}
        </Link>
      )}
    </Panel>
  );
}

/** A square shortcut: an icon on a soft square, a short label. */
export function Tile({ href, icon, label, dark = false }: { href: string; icon: IconName; label: string; dark?: boolean }) {
  return (
    <Link href={href} className={cx("flex flex-col items-center gap-2 rounded-[20px] border p-3 text-center transition active:scale-[0.97]",
      dark ? "border-transparent bg-brand text-brand-ink" : "border-line bg-surface hover:bg-bg")}>
      <span className={cx("grid size-11 place-items-center rounded-[14px]", dark ? "bg-white/10" : "bg-bg")}><Icon name={icon} size={20} /></span>
      <span className="text-xs font-semibold">{label}</span>
    </Link>
  );
}

export function SectionTitle({ title, href, link }: { title: string; href?: string; link?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between">
      <h2 className="text-[17px] font-bold tracking-tight">{title}</h2>
      {href && <Link href={href} className="text-xs font-semibold text-muted underline-offset-4 hover:underline">{link ?? "See all"}</Link>}
    </div>
  );
}

/** A big figure with a small label above it. */
export function Figure({ label, value, hint, strong = false }: { label: string; value: ReactNode; hint?: ReactNode; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className={cx("mt-1 tabular-nums tracking-tight", strong ? "text-4xl font-bold" : "text-2xl font-bold")}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** A thin bar. Below the requirement it is drawn hollow, so the difference survives in grayscale. */
export function Meter({ value, min }: { value: number | null; min?: number }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  const below = value != null && min != null && value < min;
  return (
    <span className="relative block h-1.5 w-full overflow-hidden rounded-full bg-bg">
      <span className={cx("absolute inset-y-0 left-0 rounded-full", below ? "border border-ink bg-surface" : "bg-ink")} style={{ width: `${v}%` }} />
      {min != null && <span className="absolute inset-y-0 w-px bg-muted" style={{ left: `${min}%` }} />}
    </span>
  );
}

/** A status word in a pill. "strong" fills it — used for what needs attention. */
export function Pill({ children, strong = false }: { children: ReactNode; strong?: boolean }) {
  return (
    <span className={cx("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
      strong ? "bg-ink text-surface" : "border border-line text-muted")}>{children}</span>
  );
}

/** A row in a list panel. */
export function Row({ href, lead, title, sub, end, dim = false }: { href?: string; lead?: ReactNode; title: ReactNode; sub?: ReactNode; end?: ReactNode; dim?: boolean }) {
  const body = (
    <>
      {lead}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{title}</span>
        {sub && <span className="block truncate text-xs text-muted">{sub}</span>}
      </span>
      {end}
    </>
  );
  const cls = cx("flex items-center gap-3 py-3", dim && "opacity-50");
  return <li className="border-b border-line last:border-0">{href ? <Link href={href} className={cx(cls, "-mx-2 rounded-xl px-2 hover:bg-bg")}>{body}</Link> : <div className={cls}>{body}</div>}</li>;
}

/** A small square with an icon or two or three letters. */
export function Glyph({ icon, text }: { icon?: IconName; text?: string }) {
  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-bg text-xs font-bold text-ink">
      {icon ? <Icon name={icon} size={18} /> : text}
    </span>
  );
}

export function EmptyNote({ icon, text }: { icon: IconName; text: string }) {
  return (
    <Panel className="flex flex-col items-center gap-3 py-8 text-center">
      <span className="grid size-12 place-items-center rounded-[14px] bg-bg text-muted"><Icon name={icon} size={22} /></span>
      <p className="max-w-xs text-sm text-muted">{text}</p>
    </Panel>
  );
}

/** Weekly attendance as thin vertical bars, the current week darkest. */
export function WeekBars({ points }: { points: { label: string; att: number; tot: number }[] }) {
  return (
    <div className="flex h-36 items-end gap-2">
      {points.map((p, i) => {
        const r = p.tot ? Math.round((100 * p.att) / p.tot) : null;
        const last = i === points.length - 1;
        return (
          <div key={p.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5" title={r == null ? `${p.label}: no classes` : `${p.label}: ${r}% (${p.att}/${p.tot})`}>
            <span className="text-[10px] font-semibold tabular-nums text-muted">{r == null ? "" : `${r}`}</span>
            <span className="relative w-full flex-1 overflow-hidden rounded-[8px] bg-bg">
              <span className={cx("absolute inset-x-0 bottom-0 rounded-[8px]", last ? "bg-ink" : "bg-muted/60")} style={{ height: `${r ?? 0}%` }} />
            </span>
            <span className="text-[10px] text-muted">{p.label.split(" ")[0]}</span>
          </div>
        );
      })}
    </div>
  );
}
