import type { ReactNode } from "react";
import type { Level } from "../lib/platform";

const LABEL: Record<Level, string> = {
  idle: "Not tested",
  ok: "Working",
  warn: "Needs attention",
  fail: "Not working",
};

export function StatusPill({ level, text }: { level: Level; text?: string }) {
  return <span className={`pill pill-${level}`}>{text ?? LABEL[level]}</span>;
}

export function Card(props: {
  id: string;
  icon: string;
  title: string;
  pill: ReactNode;
  actions?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section id={props.id} className={props.wide ? "card card-wide" : "card"}>
      <header className="card-head">
        <h2>
          <span aria-hidden="true">{props.icon}</span> {props.title}
        </h2>
        {props.pill}
      </header>
      <div className="card-body">{props.children}</div>
      {props.actions && <div className="actions">{props.actions}</div>}
    </section>
  );
}

export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function Note({ tone = "idle", children }: { tone?: Level; children: ReactNode }) {
  return <p className={`note note-${tone}`}>{children}</p>;
}
