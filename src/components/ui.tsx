import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "danger" | "ghost";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand text-brand-ink hover:opacity-90",
  secondary: "bg-surface text-ink border border-line hover:bg-bg",
  danger: "bg-bad text-white hover:opacity-90",
  ghost: "text-ink hover:bg-bg",
};
const BTN = "inline-flex items-center justify-center gap-2 rounded-lg px-4 h-10 text-sm font-medium transition disabled:opacity-50 disabled:pointer-events-none";

export function Button({ variant = "primary", className, ...p }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={cx(BTN, VARIANTS[variant], className)} {...p} />;
}

export function LinkButton({ variant = "primary", className, ...p }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={cx(BTN, VARIANTS[variant], className)} {...p} />;
}

export function Card({ className, ...p }: ComponentProps<"section">) {
  return <section className={cx("rounded-2xl bg-surface p-5 shadow-card", className)} {...p} />;
}

export function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="text-base font-semibold">{children}</h2>
      {action}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

const INPUT = "w-full rounded-lg border border-line bg-surface px-3 h-10 text-sm placeholder:text-muted/70 focus:border-info focus:outline-none";
export function Input({ className, ...p }: ComponentProps<"input">) {
  return <input className={cx(INPUT, className)} {...p} />;
}
export function Select({ className, ...p }: ComponentProps<"select">) {
  return <select className={cx(INPUT, className)} {...p} />;
}
export function Textarea({ className, ...p }: ComponentProps<"textarea">) {
  return <textarea className={cx(INPUT, "h-auto min-h-24 py-2", className)} {...p} />;
}

const STATUS: Record<string, [string, string]> = {
  present: ["Present", "bg-ok/10 text-ok"],
  late: ["Late", "bg-warn/10 text-warn"],
  absent: ["Absent", "bg-bad/10 text-bad"],
  excused: ["Excused", "bg-info/10 text-info"],
  pending_verification: ["Pending review", "bg-warn/10 text-warn"],
  disputed: ["Disputed", "bg-info/10 text-info"],
  open: ["Open", "bg-ok/10 text-ok"],
  closed: ["Closed", "bg-muted/10 text-muted"],
  active: ["Active", "bg-ok/10 text-ok"],
  pending: ["Pending", "bg-warn/10 text-warn"],
  suspended: ["Suspended", "bg-bad/10 text-bad"],
  trialing: ["Trial", "bg-info/10 text-info"],
  upheld: ["Upheld", "bg-ok/10 text-ok"],
  rejected: ["Rejected", "bg-bad/10 text-bad"],
};
export function Badge({ status, children }: { status?: string; children?: ReactNode }) {
  const [label, tone] = STATUS[status ?? ""] ?? [status ?? "", "bg-bg text-muted"];
  return <span className={cx("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", tone)}>{children ?? label}</span>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </Card>
  );
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: string }) {
  const rows = Array.isArray(children) ? children.flat().filter(Boolean) : children ? [children] : [];
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
            {head.map((h, i) => <th key={i} className="px-5 py-2 font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.length ? children : (
            <tr><td colSpan={head.length} className="px-5 py-8 text-center text-muted">{empty ?? "Nothing here yet."}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
export const Td = ({ className, ...p }: ComponentProps<"td">) => <td className={cx("px-5 py-2.5 align-middle", className)} {...p} />;

export function Notice({ tone = "info", children }: { tone?: "info" | "ok" | "warn" | "bad"; children: ReactNode }) {
  const t = { info: "border-info/30 bg-info/5", ok: "border-ok/30 bg-ok/5", warn: "border-warn/30 bg-warn/5", bad: "border-bad/30 bg-bad/5" }[tone];
  return <div role={tone === "bad" ? "alert" : "status"} className={cx("rounded-lg border px-4 py-3 text-sm", t)}>{children}</div>;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export const pct = (v: number | string | null | undefined) => (v == null ? "—" : `${Number(v).toFixed(1)}%`);
export const when = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" }) : "—";
