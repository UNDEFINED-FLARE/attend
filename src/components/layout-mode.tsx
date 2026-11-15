"use client";
// Scroll or Buttons (see lib/layout-mode.ts): the choice, the switch, and a page made of parts
// that is either one long page or one part at a time picked from a row of buttons.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { LAYOUT_COOKIE, partFromHash, type LayoutMode } from "@/lib/layout-mode";

type Ctx = { mode: LayoutMode; setMode: (m: LayoutMode) => void };
const LayoutCtx = createContext<Ctx>({ mode: "scroll", setMode: () => {} });

export function LayoutModeProvider({ initial, children }: { initial: LayoutMode; children: ReactNode }) {
  const [mode, setState] = useState<LayoutMode>(initial);
  const setMode = useCallback((m: LayoutMode) => {
    setState(m);
    // A year, on this device only; the server reads it to draw the right layout first time.
    document.cookie = `${LAYOUT_COOKIE}=${m}; path=/; max-age=31536000; samesite=lax`;
  }, []);
  return <LayoutCtx.Provider value={{ mode, setMode }}>{children}</LayoutCtx.Provider>;
}

const MODES: [LayoutMode, string][] = [["scroll", "Scroll"], ["buttons", "Buttons"]];

/** The two-way switch. A radio group: arrow keys move between the two choices. */
export function LayoutToggle({ className = "" }: { className?: string }) {
  const { mode, setMode } = useContext(LayoutCtx);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const next = mode === "scroll" ? 1 : 0;
    setMode(MODES[next][0]);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label="Page layout" onKeyDown={onKey}
      className={`inline-flex items-center gap-0.5 rounded-full bg-surface p-0.5 ring-1 ring-line ${className}`}>
      {MODES.map(([m, label], i) => (
        <button key={m} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={mode === m}
          tabIndex={mode === m ? 0 : -1} onClick={() => setMode(m)}
          className={`h-8 rounded-full px-3 text-xs font-semibold transition-colors ${mode === m ? "bg-brand text-brand-ink" : "text-muted hover:text-ink"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

export type Part = { id: string; label: string; content: ReactNode };

const pill = (on: boolean) =>
  `inline-flex h-10 shrink-0 items-center rounded-full px-4 text-sm font-medium transition-colors ${
    on ? "bg-brand text-brand-ink" : "bg-surface text-ink ring-1 ring-line hover:bg-bg"}`;

/**
 * A page made of parts.
 * - Scroll: `scrollView` if given (so a page keeps its own arrangement), else the parts one under the other.
 *   With `jumpLinks`, a row of buttons at the top scrolls to each part.
 * - Buttons: a row of buttons (tabs); only the chosen part shows, with Previous and Next under it.
 *   A link such as /#part-checks opens that part, and the address follows the choice.
 */
export function Parts({ parts, label, scrollView, jumpLinks = false, toggle = false, navClassName = "", barClassName = "mb-6", stepClassName = "mt-8" }: {
  parts: Part[];
  /** What the row of buttons is called for screen readers, e.g. "Home". */
  label: string;
  scrollView?: ReactNode;
  jumpLinks?: boolean;
  /** Show the Scroll/Buttons switch at the end of the row of buttons. */
  toggle?: boolean;
  /** Classes for the inner row (e.g. a page-width container), the bar around it, and the Previous/Next row. */
  navClassName?: string;
  barClassName?: string;
  stepClassName?: string;
}) {
  const { mode } = useContext(LayoutCtx);
  const ids = parts.map((p) => p.id);
  const idKey = ids.join("|");
  const [active, setActive] = useState(ids[0]);
  const top = useRef<HTMLDivElement>(null);
  const tabs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Open the part a link asks for (/student#part-modules). The address is only known in the
  // browser, so this runs after the first draw rather than during it (no hydration mismatch).
  useEffect(() => {
    const id = partFromHash(window.location.hash, idKey.split("|"));
    if (id) setActive(id);
  }, [idKey]);

  const go = (id: string, focusTab = false) => {
    setActive(id);
    window.history.replaceState(null, "", `#part-${id}`);
    if (focusTab) tabs.current[id]?.focus();
    // The new part starts at the top of the screen, not wherever the last one was scrolled to.
    if ((top.current?.getBoundingClientRect().top ?? 0) < 0) top.current?.scrollIntoView({ block: "start" });
  };

  const onKey = (e: KeyboardEvent, i: number) => {
    const n = parts.length;
    const j = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n
      : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (j < 0) return;
    e.preventDefault();
    go(parts[j].id, true);
  };

  const row = (asTabs: boolean) => (
    <div className={`flex items-center gap-3 ${navClassName}`}>
      <div role={asTabs ? "tablist" : undefined} aria-label={label}
        className="-mx-1 flex min-w-0 flex-1 gap-2 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {parts.map((p, i) => asTabs ? (
          <button key={p.id} ref={(el) => { tabs.current[p.id] = el; }} type="button" role="tab" id={`tab-${p.id}`}
            aria-selected={active === p.id} aria-controls={`part-${p.id}`} tabIndex={active === p.id ? 0 : -1}
            onClick={() => go(p.id)} onKeyDown={(e) => onKey(e, i)} className={pill(active === p.id)}>
            {p.label}
          </button>
        ) : (
          <a key={p.id} href={`#part-${p.id}`} className={pill(false)}>{p.label}</a>
        ))}
      </div>
      {toggle && <LayoutToggle className="shrink-0" />}
    </div>
  );

  if (mode === "scroll") {
    return (
      <div>
        {jumpLinks ? <div className={barClassName}>{row(false)}</div>
          : toggle ? <div className={barClassName}><div className={`flex justify-end ${navClassName}`}><LayoutToggle /></div></div> : null}
        {scrollView ?? (
          <div className="space-y-6">
            {parts.map((p) => <section key={p.id} id={`part-${p.id}`} aria-label={p.label} className="scroll-mt-24">{p.content}</section>)}
          </div>
        )}
      </div>
    );
  }

  const i = Math.max(0, ids.indexOf(active));
  const cur = parts[i], prev = parts[i - 1], next = parts[i + 1];
  if (!cur) return null;
  return (
    <div ref={top} className="scroll-mt-24">
      <div className={barClassName}>{row(true)}</div>
      <div role="tabpanel" id={`part-${cur.id}`} aria-labelledby={`tab-${cur.id}`} tabIndex={0} className="rounded-3xl outline-offset-4">
        {cur.content}
      </div>
      {(prev || next) && (
        <nav aria-label={`${label}: previous and next`} className={`flex items-center justify-between gap-3 ${stepClassName}`}>
          {prev ? (
            <button type="button" onClick={() => go(prev.id)} className={`${pill(false)} gap-2`}>
              <Icon name="arrowRight" size={16} className="rotate-180" /><span><span className="sr-only">Previous: </span>{prev.label}</span>
            </button>
          ) : <span />}
          {next && (
            <button type="button" onClick={() => go(next.id)} className={`${pill(true)} gap-2`}>
              <span><span className="sr-only">Next: </span>{next.label}</span><Icon name="arrowRight" size={16} />
            </button>
          )}
        </nav>
      )}
    </div>
  );
}
