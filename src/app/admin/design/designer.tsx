"use client";
import { useActionState, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { Submit } from "@/components/form";
import { Icon } from "@/components/icons";
import { Input, Notice, Select } from "@/components/ui";
import { CARD_LABEL, DEFAULT_THEME, inkOn, paletteFor, themeStyle, type StudentCard, type Theme } from "@/lib/theme";
import { discardThemeDraft, loadThemeVersion, publishTheme, saveThemeDraft, uploadLogo } from "./actions";
import { FeatureSwitches, MenuEditor } from "./menus-features";

type S = { error?: string; ok?: string; at?: string } | undefined;
export type Version = { id: string; note: string | null; by: string | null; at: string };
type Scheme = "light" | "dark";
const when = (iso: string) => new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" });

// Starting points only; every colour stays editable.
const PRESETS: { name: string; colors: Partial<Theme["colors"]>; hero: [string, string]; gradientTo: string }[] = [
  { name: "Graphite (default)", colors: DEFAULT_THEME.colors, hero: ["#45484d", "#2d2f33"], gradientTo: "#45484d" },
  { name: "Navy", colors: { primary: "#0b2545", accent: "#2f6fed", background: "#f3f6fb", surface: "#ffffff", text: "#0f1b2d", muted: "#64748b",
    success: "#16a34a", warning: "#d97706", danger: "#dc2626" }, hero: ["#1d4ed8", "#0b2545"], gradientTo: "#2f6fed" },
  { name: "Maroon & gold", colors: { primary: "#6d1a2c", accent: "#c8961e", background: "#faf7f2", surface: "#ffffff", text: "#2a1a1d" }, hero: ["#8b2336", "#4a0f1c"], gradientTo: "#a0283f" },
  { name: "Forest", colors: { primary: "#14532d", accent: "#16a34a", background: "#f2f7f3", surface: "#ffffff", text: "#0f1f15" }, hero: ["#15803d", "#14532d"], gradientTo: "#16a34a" },
  { name: "Ocean", colors: { primary: "#0c4a6e", accent: "#0891b2", background: "#f0f7fa", surface: "#ffffff", text: "#0b1f2a" }, hero: ["#0891b2", "#0c4a6e"], gradientTo: "#0e7490" },
  { name: "Royal", colors: { primary: "#3b0764", accent: "#7c3aed", background: "#f7f5fb", surface: "#ffffff", text: "#1e1030" }, hero: ["#7c3aed", "#3b0764"], gradientTo: "#6d28d9" },
];

// Dark styles fill the dark palette and switch the design to dark (or keep "follow the device").
const DARK_PRESETS: { name: string; dark: Theme["appearance"]["dark"] }[] = [
  { name: "Graphite dark", dark: DEFAULT_THEME.appearance.dark },
  { name: "Midnight", dark: { primary: "#9db8ff", accent: "#4f74d8", background: "#0d1320", surface: "#161e2e", text: "#e3e9f5", muted: "#93a0b8",
    success: "#5fc28a", warning: "#e0ad4f", danger: "#ef7b72" } },
  { name: "Charcoal & gold", dark: { primary: "#e2c06b", accent: "#a37d22", background: "#141311", surface: "#1f1d1a", text: "#ece7dc", muted: "#a39d90",
    success: "#6fbf8b", warning: "#e0ad4f", danger: "#e07a72" } },
];

const COLOR_FIELDS: [keyof Theme["colors"], string][] = [
  ["primary", "Main colour"], ["accent", "Highlight"], ["background", "Page background"], ["surface", "Cards"],
  ["text", "Text"], ["muted", "Secondary text"], ["success", "Present / success"], ["warning", "Late / warning"], ["danger", "Absent / error"],
];

export function Designer({ published, draft, versions, historyReady, slug, institutionName }: {
  published: Theme; draft: { theme: Theme; at: string; by: string | null } | null; versions: Version[];
  historyReady: boolean; slug: string | null; institutionName: string;
}) {
  const initial = draft?.theme ?? published;
  const [t, setT] = useState<Theme>(initial);
  const [base, setBase] = useState<Theme>(initial);
  const [scheme, setScheme] = useState<Scheme>(initial.appearance.mode === "dark" ? "dark" : "light");
  const [pub, publish] = useActionState(publishTheme, undefined as S);
  const [drafted, saveDraft] = useActionState(saveThemeDraft, undefined as S);
  const [msg, setMsg] = useState<S>(undefined);
  const [busy, start] = useTransition();
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const live = JSON.stringify(t) === JSON.stringify(published);
  // After a successful save the current editor state is the new baseline.
  useEffect(() => { if (pub?.ok || drafted?.ok) setBase(t); }, [pub, drafted]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (t.appearance.mode !== "auto") setScheme(t.appearance.mode); }, [t.appearance.mode]);
  const set = <K extends keyof Theme>(k: K, v: Partial<Theme[K]>) => setT((p) => ({ ...p, [k]: { ...(p[k] as object), ...(v as object) } as Theme[K] }));
  const moveCard = (i: number, d: -1 | 1) => setT((p) => {
    const cards = [...p.student.cards]; const j = i + d;
    if (j < 0 || j >= cards.length) return p;
    [cards[i], cards[j]] = [cards[j], cards[i]];
    return { ...p, student: { ...p.student, cards } };
  });
  const setCard = (i: number, v: Partial<Theme["student"]["cards"][number]>) =>
    setT((p) => ({ ...p, student: { ...p.student, cards: p.student.cards.map((c, k) => (k === i ? { ...c, ...v } : c)) } }));
  const dirty = JSON.stringify(t) !== JSON.stringify(base);
  const loginLink = slug ? `${origin}/login?i=${slug}` : null;

  return (
    <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
      <div className="space-y-3">
        <Section title="Start from a style" open>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-2">
            {PRESETS.map((p) => (
              <button key={p.name} type="button" onClick={() => setT((c) => ({ ...c, colors: { ...c.colors, ...p.colors },
                header: { ...c.header, gradientTo: p.gradientTo }, student: { ...c.student, heroFrom: p.hero[0], heroTo: p.hero[1] } }))}
                className="flex items-center gap-2 rounded-xl border border-line p-2 text-left text-xs font-medium hover:bg-bg">
                <span className="flex"><i className="size-5 rounded-l-md" style={{ background: p.colors.primary }} /><i className="size-5 rounded-r-md" style={{ background: p.colors.accent }} /></span>
                {p.name}
              </button>
            ))}
          </div>
          <p className="pt-1 text-xs font-medium text-muted">Dark styles</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-2">
            {DARK_PRESETS.map((p) => (
              <button key={p.name} type="button" onClick={() => setT((c) => ({ ...c, appearance: { mode: c.appearance.mode === "light" ? "dark" : c.appearance.mode, dark: p.dark } }))}
                className="flex items-center gap-2 rounded-xl border border-line p-2 text-left text-xs font-medium hover:bg-bg">
                <span className="flex"><i className="size-5 rounded-l-md" style={{ background: p.dark.background }} /><i className="size-5 rounded-r-md" style={{ background: p.dark.primary }} /></span>
                {p.name}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Light and dark" open>
          <Row label="Appearance">
            <Seg value={t.appearance.mode} options={[["light", "Light"], ["dark", "Dark"], ["auto", "Follow the device"]]}
              onChange={(mode) => set("appearance", { mode })} />
          </Row>
          <p className="text-[11px] text-muted">
            {t.appearance.mode === "auto" ? "Each person sees light or dark to match their phone or computer setting." : t.appearance.mode === "dark" ? "Everyone sees the dark colours below." : "Everyone sees the light colours. Switch to Dark or Follow the device to use the dark colours."}
          </p>
          {t.appearance.mode !== "light" && (
            <div className="grid grid-cols-2 gap-2">
              {COLOR_FIELDS.map(([k, label]) => (
                <Color key={k} label={`Dark: ${label.toLowerCase()}`} value={t.appearance.dark[k]} onChange={(v) => set("appearance", { dark: { ...t.appearance.dark, [k]: v } })} />
              ))}
            </div>
          )}
        </Section>

        <Section title="Colours">
          <div className="grid grid-cols-2 gap-2">
            {COLOR_FIELDS.map(([k, label]) => (
              <Color key={k} label={label} value={t.colors[k]} onChange={(v) => set("colors", { [k]: v })} />
            ))}
          </div>
        </Section>

        <Section title="Shape and lettering">
          <Row label="Corners">
            <Seg value={t.shape} options={[["sharp", "Sharp"], ["rounded", "Rounded"], ["soft", "Soft"]]} onChange={(v) => setT((p) => ({ ...p, shape: v }))} />
          </Row>
          <Row label="Font">
            <Select value={t.font} onChange={(e) => setT((p) => ({ ...p, font: e.target.value as Theme["font"] }))}>
              <option value="system">Clean (system)</option><option value="rounded">Friendly (rounded)</option>
              <option value="serif">Classic (serif)</option><option value="mono">Technical (mono)</option>
            </Select>
          </Row>
        </Section>

        <Section title="Header">
          <Row label="Style"><Seg value={t.header.style} options={[["light", "Light"], ["solid", "Solid"], ["gradient", "Gradient"]]} onChange={(v) => set("header", { style: v })} /></Row>
          {t.header.style === "gradient" && <Color label="Gradient to" value={t.header.gradientTo} onChange={(v) => set("header", { gradientTo: v })} />}
          <Row label="Title"><Input value={t.header.title} maxLength={60} placeholder="UniAttend" onChange={(e) => set("header", { title: e.target.value })} /></Row>
          <Row label="Subtitle"><Input value={t.header.subtitle} maxLength={80} placeholder={institutionName} onChange={(e) => set("header", { subtitle: e.target.value })} /></Row>
          <LogoPicker value={t.header.logoUrl} onChange={(logoUrl) => set("header", { logoUrl })} />
          <Check label="Show today's date" checked={t.header.showDate} onChange={(v) => set("header", { showDate: v })} />
        </Section>

        <Section title="Sign-in screen">
          <Row label="Headline"><Input value={t.login.headline} maxLength={80} onChange={(e) => set("login", { headline: e.target.value })} /></Row>
          <Row label="Message"><Input value={t.login.message} maxLength={240} onChange={(e) => set("login", { message: e.target.value })} /></Row>
          <p className="text-[11px] text-muted">
            The sign-in, registration and password pages use your logo, colours and this text.
            {loginLink ? <> Share this link so people land on your branded sign-in: <span className="break-all font-mono text-ink">{loginLink}</span>. After someone signs out, their device keeps your branding.</> : null}
          </p>
        </Section>

        <Section title="Side menu">
          <Seg value={t.sidebar.style} options={[["light", "Light"], ["dark", "Dark"], ["brand", "Main colour"]]} onChange={(v) => set("sidebar", { style: v })} />
        </Section>

        <Section title="Announcement banner">
          <Check label="Show a banner under the header" checked={t.announcement.show} onChange={(v) => set("announcement", { show: v })} />
          <Row label="Message"><Input value={t.announcement.text} maxLength={240} placeholder="Exams start 3 June. Check your venues on the map." onChange={(e) => set("announcement", { text: e.target.value })} /></Row>
          <Row label="Colour"><Seg value={t.announcement.tone} options={[["info", "Info"], ["ok", "Good news"], ["warn", "Notice"], ["bad", "Urgent"]]} onChange={(v) => set("announcement", { tone: v })} /></Row>
        </Section>

        <Section title="Footer">
          <Check label="Show a footer" checked={t.footer.show} onChange={(v) => set("footer", { show: v })} />
          <Row label="Text"><Input value={t.footer.text} maxLength={200} placeholder={`© ${new Date().getFullYear()} ${institutionName}`} onChange={(e) => set("footer", { text: e.target.value })} /></Row>
          <div className="space-y-2">
            {t.footer.links.map((l, i) => (
              <div key={i} className="flex gap-1">
                <Input value={l.label} maxLength={40} placeholder="Label" className="w-28" onChange={(e) => set("footer", { links: t.footer.links.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} />
                <Input value={l.url} maxLength={500} placeholder="https://… or mailto:" onChange={(e) => set("footer", { links: t.footer.links.map((x, k) => (k === i ? { ...x, url: e.target.value.trim() } : x)) })} />
                <button type="button" aria-label="Remove link" className="grid size-10 shrink-0 place-items-center rounded-lg text-muted hover:bg-bad/10 hover:text-bad"
                  onClick={() => set("footer", { links: t.footer.links.filter((_, k) => k !== i) })}><Icon name="x" size={16} /></button>
              </div>
            ))}
            {t.footer.links.length < 6 && (
              <button type="button" className="inline-flex items-center gap-1 text-sm font-medium text-accent"
                onClick={() => set("footer", { links: [...t.footer.links, { label: "", url: "" }] })}><Icon name="plus" size={16} />Add a link</button>
            )}
          </div>
        </Section>

        <Section title="Features">
          <FeatureSwitches value={t.features} onChange={(features) => setT((p) => ({ ...p, features }))} />
        </Section>

        <Section title="Menus">
          <MenuEditor value={t.menus} features={t.features} onChange={(menus) => setT((p) => ({ ...p, menus }))} />
        </Section>

        <Section title="Student home" open>
          <Row label="Greeting" hint="{greeting} becomes Good morning/afternoon/evening; {name} the student's first name.">
            <Input value={t.student.greeting} maxLength={60} onChange={(e) => set("student", { greeting: e.target.value })} />
          </Row>
          <Row label="Summary card title"><Input value={t.student.heroTitle} maxLength={60} onChange={(e) => set("student", { heroTitle: e.target.value })} /></Row>
          <div className="grid grid-cols-2 gap-2">
            <Color label="Summary from" value={t.student.heroFrom} onChange={(v) => set("student", { heroFrom: v })} />
            <Color label="Summary to" value={t.student.heroTo} onChange={(v) => set("student", { heroTo: v })} />
          </div>
          <p className="pt-1 text-sm font-medium">Cards: order, names and visibility</p>
          <ol className="space-y-1.5">
            {t.student.cards.map((c, i) => (
              <li key={c.id} className={`flex items-center gap-2 rounded-xl border border-line p-2 ${c.show ? "" : "opacity-60"}`}>
                <span className="flex flex-col">
                  <button type="button" aria-label={`Move ${CARD_LABEL[c.id]} up`} disabled={i === 0} onClick={() => moveCard(i, -1)} className="px-1 text-muted disabled:opacity-30">▲</button>
                  <button type="button" aria-label={`Move ${CARD_LABEL[c.id]} down`} disabled={i === t.student.cards.length - 1} onClick={() => moveCard(i, 1)} className="px-1 text-muted disabled:opacity-30">▼</button>
                </span>
                <Input value={c.title} maxLength={40} aria-label={`Title for ${CARD_LABEL[c.id]}`} className="h-9" onChange={(e) => setCard(i, { title: e.target.value })} />
                <label className="flex shrink-0 items-center gap-1 text-xs">
                  <input type="checkbox" checked={c.show} onChange={(e) => setCard(i, { show: e.target.checked })} className="size-4" />Show
                </label>
              </li>
            ))}
          </ol>
        </Section>

        <Section title="Version history">
          {!historyReady ? (
            <p className="text-xs text-muted">Version history needs the latest database update (migration 0019).</p>
          ) : versions.length === 0 ? (
            <p className="text-xs text-muted">Every design you publish is kept here (the last 30), so you can go back to it.</p>
          ) : (
            <ol className="space-y-1.5">
              {versions.map((v, i) => (
                <li key={v.id} className="flex items-center gap-2 rounded-xl border border-line p-2">
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-xs font-semibold">{v.note || (i === 0 ? "Current design" : "Published design")}{i === 0 && <span className="ml-1 rounded-full bg-ok/15 px-1.5 text-[10px] text-ok">live</span>}</span>
                    <span className="block truncate text-[11px] text-muted">{when(v.at)}{v.by ? ` · ${v.by}` : ""}</span>
                  </span>
                  <button type="button" disabled={busy} className="h-8 shrink-0 rounded-lg border border-line px-2.5 text-xs font-medium hover:bg-bg disabled:opacity-50"
                    onClick={() => start(async () => {
                      const r = await loadThemeVersion(v.id);
                      if (r.theme) { setT(r.theme); setMsg({ ok: "Loaded into the editor. Check the preview, then publish to make it live again." }); }
                      else setMsg({ error: r.error });
                    })}>Load</button>
                </li>
              ))}
            </ol>
          )}
        </Section>

        <div className="sticky bottom-24 z-10 space-y-2 rounded-2xl bg-surface p-3 shadow-card lg:bottom-4">
          {draft && !pub?.ok && (
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <span className="rounded-full bg-warn/15 px-2 py-0.5 font-semibold text-warn">Draft</span>
              Saved {when(drafted?.at ?? draft.at)}{draft.by ? ` by ${draft.by}` : ""}. Not live yet.
              <button type="button" disabled={busy} className="font-medium text-bad underline-offset-2 hover:underline"
                onClick={() => start(async () => { const r = await discardThemeDraft(); setMsg(r); if (r?.ok) { setT(published); setBase(published); } })}>Discard draft</button>
            </p>
          )}
          <form action={publish} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="theme" value={JSON.stringify(t)} />
            <input name="note" maxLength={120} placeholder="What changed? (optional)" aria-label="Note for this version"
              className="h-10 min-w-0 flex-1 basis-40 rounded-xl border border-line bg-bg px-3 text-sm" />
            <Submit label={live ? "Published" : "Publish"} pending="Publishing…" />
            <button type="submit" formAction={saveDraft} disabled={!dirty} className="h-10 rounded-xl border border-line px-3 text-sm font-medium hover:bg-bg disabled:opacity-50">Save draft</button>
          </form>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="h-9 rounded-xl px-3 text-sm text-muted hover:bg-bg disabled:opacity-50" onClick={() => setT(base)} disabled={!dirty}>Undo changes</button>
            <button type="button" className="h-9 rounded-xl px-3 text-sm text-muted hover:bg-bg" onClick={() => setT(DEFAULT_THEME)}>Start over</button>
          </div>
          {[pub, drafted, msg].map((r, i) => r?.error ? <Notice key={i} tone="bad">{r.error}</Notice> : null)}
          {pub?.ok && live && <Notice tone="ok">{pub.ok}</Notice>}
          {drafted?.ok && !dirty && !pub?.ok && <Notice tone="ok">{drafted.ok}</Notice>}
          {msg?.ok && <Notice tone="info">{msg.ok}</Notice>}
        </div>
      </div>

      <Preview t={t} institutionName={institutionName} scheme={scheme} setScheme={t.appearance.mode === "auto" ? setScheme : undefined} />
    </div>
  );
}

/* ------------------------------------------------------------------ preview */

function Preview({ t, institutionName, scheme, setScheme }: { t: Theme; institutionName: string; scheme: Scheme; setScheme?: (s: Scheme) => void }) {
  const c = paletteFor(t, scheme);
  const style = themeStyle(t, scheme);
  const headBg = t.header.style === "solid" ? c.primary : t.header.style === "gradient" ? `linear-gradient(90deg, ${c.primary}, ${t.header.gradientTo})` : c.surface;
  const headInk = t.header.style === "light" ? c.text : inkOn(c.primary);
  const sideBg = t.sidebar.style === "dark" ? "#16171a" : t.sidebar.style === "brand" ? c.primary : c.surface;
  const sideInk = t.sidebar.style === "light" ? c.text : inkOn(sideBg);
  const Logo = ({ ink }: { ink: string }) => (
    <span className="flex min-w-0 items-center gap-2">
      {t.header.logoUrl
        // eslint-disable-next-line @next/next/no-img-element -- preview of the admin's logo link
        ? <img src={t.header.logoUrl} alt="" className="size-7 rounded-lg bg-white object-contain p-0.5" referrerPolicy="no-referrer" />
        : <span className="grid size-7 place-items-center rounded-lg" style={{ background: c.primary, color: inkOn(c.primary) }}><Icon name="check" size={15} strokeWidth={2.6} /></span>}
      <span className="min-w-0 leading-tight" style={{ color: ink }}>
        <span className="block truncate text-xs font-semibold">{t.header.title || "UniAttend"}</span>
        <span className="block truncate text-[10px] opacity-70">{t.header.subtitle || institutionName}</span>
      </span>
    </span>
  );
  const tone = { info: c.accent, ok: c.success, warn: c.warning, bad: c.danger }[t.announcement.tone];
  const hello = (t.student.greeting || "{greeting}").replace("{greeting}", "Good morning").replace("{name}", "Thabo");

  const card = (id: StudentCard, title: string): ReactNode => {
    switch (id) {
      case "hero": return (
        <div className="rounded-3xl p-4" style={{ background: `linear-gradient(135deg, ${t.student.heroFrom}, ${t.student.heroTo})`, color: inkOn(t.student.heroFrom) }}>
          <p className="text-[10px] opacity-80">{t.student.heroTitle || "Your attendance"}</p>
          <p className="text-2xl font-semibold">86%</p><p className="text-[10px] opacity-80">24 of 28 sessions attended</p>
        </div>);
      case "live": return (
        <div className="rounded-3xl bg-surface p-3 shadow-card" style={{ boxShadow: `0 0 0 2px ${c.success}55` }}>
          <p className="text-[9px] font-semibold uppercase" style={{ color: c.success }}>● Happening now</p>
          <p className="text-xs font-semibold">CSC1541 · B-Block</p>
          <p className="mt-2 rounded-lg py-1.5 text-center text-[10px] font-medium text-white" style={{ background: c.accent }}>Check in now</p>
        </div>);
      case "quick": return (
        <div className="grid grid-cols-4 gap-1.5">
          {(["scan", "history", "calendar", "map"] as const).map((i) => (
            <span key={i} className="grid h-11 place-items-center rounded-2xl bg-surface shadow-card" style={{ color: c.accent }}><Icon name={i} size={16} /></span>
          ))}
        </div>);
      default: return (
        <div>
          <p className="mb-1 text-xs font-semibold">{title}</p>
          <div className="space-y-1">
            {[0, 1].map((k) => (
              <div key={k} className="flex items-center gap-2 rounded-2xl bg-surface p-2 shadow-card">
                <span className="h-6 w-1 rounded-full" style={{ background: k ? c.warning : c.accent }} />
                <span className="flex-1"><span className="block h-2 w-20 rounded bg-current opacity-20" /><span className="mt-1 block h-1.5 w-12 rounded bg-current opacity-10" /></span>
                <span className="text-[10px] font-semibold" style={{ color: k ? c.warning : c.success }}>{k ? "Late" : "92%"}</span>
              </div>
            ))}
          </div>
        </div>);
    }
  };

  return (
    <div className="space-y-4 xl:sticky xl:top-20 xl:self-start">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Live preview (sample data)</p>
        {setScheme && <div className="w-44"><Seg value={scheme} options={[["light", "Light"], ["dark", "Dark"]]} onChange={setScheme} /></div>}
      </div>
      {/* Desktop */}
      <div style={style} className="overflow-hidden rounded-2xl border border-line font-sans shadow-card">
        <div className="flex h-56">
          <div className="w-32 shrink-0 space-y-1.5 border-r border-line p-2" style={{ background: sideBg, color: sideInk }}>
            <Logo ink={sideInk} />
            {["Dashboard", "Timetable", "Map"].map((x, i) => (
              <div key={x} className="rounded-lg px-2 py-1 text-[10px]" style={i === 0 ? { background: t.sidebar.style === "light" ? `${c.accent}1a` : "rgb(255 255 255 / 0.15)", color: t.sidebar.style === "light" ? c.accent : undefined } : { opacity: 0.75 }}>{x}</div>
            ))}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex h-9 items-center justify-between border-b border-line px-3" style={{ background: headBg, color: headInk }}>
              <span className="text-[10px] opacity-80">{t.header.showDate ? "Mon, 9 Nov 2026" : ""}</span>
              <span className="flex items-center gap-2"><Icon name="bell" size={14} /><span className="grid size-5 place-items-center rounded-full text-[9px] font-bold" style={{ background: c.primary, color: inkOn(c.primary) }}>K</span></span>
            </div>
            {t.announcement.show && t.announcement.text && <div className="truncate px-3 py-1 text-center text-[10px] font-medium" style={{ background: `${tone}1a`, color: tone }}>{t.announcement.text}</div>}
            <div className="grid flex-1 grid-cols-3 gap-2 p-3">
              {["Present today", "Late", "Rate"].map((x, i) => (
                <div key={x} className="rounded-2xl bg-surface p-2 shadow-card">
                  <p className="text-[9px]" style={{ color: c.muted }}>{x}</p>
                  <p className="text-sm font-semibold" style={{ color: [c.text, c.warning, c.success][i] }}>{["342", "18", "91%"][i]}</p>
                </div>
              ))}
            </div>
            {t.footer.show && (
              <div className="flex justify-between gap-2 border-t border-line bg-surface px-3 py-1.5 text-[9px]" style={{ color: c.muted }}>
                <span className="truncate">{t.footer.text || `© ${institutionName}`}</span>
                <span className="flex gap-2">{t.footer.links.slice(0, 3).map((l, i) => <span key={i}>{l.label || "Link"}</span>)}</span>
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Phone */}
      <div className="mx-auto w-64 rounded-[2rem] border-4 border-ink/80 p-1 shadow-card">
        <div style={style} className="h-[30rem] overflow-y-auto rounded-[1.6rem] font-sans">
          <div className="flex items-center justify-between px-3 py-2" style={{ background: headBg, color: headInk }}><Logo ink={headInk} /><Icon name="bell" size={14} /></div>
          {t.announcement.show && t.announcement.text && <div className="px-3 py-1 text-center text-[9px] font-medium" style={{ background: `${tone}1a`, color: tone }}>{t.announcement.text}</div>}
          <div className="space-y-3 p-3">
            <div><p className="text-[10px]" style={{ color: c.muted }}>{hello} 👋</p><p className="text-base font-semibold">Thabo</p></div>
            {t.student.cards.filter((c) => c.show).map((c) => <div key={c.id}>{card(c.id, c.title)}</div>)}
          </div>
          {t.footer.show && <div className="px-3 pb-3 text-center text-[9px]" style={{ color: c.muted }}>{t.footer.text || `© ${institutionName}`}</div>}
        </div>
      </div>
      {/* Sign-in */}
      <div style={style} className="overflow-hidden rounded-2xl border border-line font-sans shadow-card">
        <div className="grid h-52 grid-cols-2">
          <div className="flex flex-col justify-between p-4" style={{ background: c.primary, color: inkOn(c.primary) }}>
            <span className="flex min-w-0 items-center gap-2">
              {t.header.logoUrl
                // eslint-disable-next-line @next/next/no-img-element -- preview of the admin's logo
                ? <img src={t.header.logoUrl} alt="" className="size-7 rounded-lg bg-white object-contain p-0.5" referrerPolicy="no-referrer" />
                : <span className="grid size-7 place-items-center rounded-lg bg-white/15"><Icon name="check" size={15} strokeWidth={2.6} /></span>}
              <span className="truncate text-[11px] font-semibold">{t.header.title || institutionName}</span>
            </span>
            <span><span className="block text-sm font-semibold leading-snug">{t.login.headline}</span><span className="mt-1 line-clamp-3 block text-[9px] opacity-80">{t.login.message}</span></span>
          </div>
          <div className="flex flex-col justify-center gap-1.5 p-4">
            <p className="text-xs font-semibold">Sign in</p>
            <span className="h-6 rounded-md border border-line bg-surface" /><span className="h-6 rounded-md border border-line bg-surface" />
            <span className="grid h-6 place-items-center rounded-md text-[9px] font-semibold" style={{ background: c.primary, color: inkOn(c.primary) }}>Sign in</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- controls */

function Section({ title, open, children }: { title: string; open?: boolean; children: ReactNode }) {
  return (
    <details open={open} className="group rounded-2xl bg-surface p-4 shadow-card">
      <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold">
        {title}<span className="text-muted transition group-open:rotate-90"><Icon name="arrowRight" size={16} /></span>
      </summary>
      <div className="mt-3 space-y-3">{children}</div>
    </details>
  );
}
function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="block space-y-1"><span className="text-xs font-medium">{label}</span>{children}{hint && <span className="block text-[11px] text-muted">{hint}</span>}</label>;
}
function Color({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 rounded-xl border border-line p-1.5 pr-2">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="size-8 cursor-pointer rounded-lg border-0 bg-transparent p-0" />
      <span className="min-w-0 leading-tight"><span className="block truncate text-xs font-medium">{label}</span><span className="font-mono text-[10px] text-muted">{value}</span></span>
    </label>
  );
}
function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4" />{label}</label>;
}
function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-xl bg-bg p-1" role="radiogroup">
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium ${value === v ? "bg-surface shadow-sm" : "text-muted"}`}>{l}</button>
      ))}
    </div>
  );
}

function LogoPicker({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium">Logo</span>
      <div className="flex items-center gap-2">
        {value
          // eslint-disable-next-line @next/next/no-img-element -- the admin's logo
          ? <img src={value} alt="Current logo" className="size-12 shrink-0 rounded-xl border border-line bg-white object-contain p-1" referrerPolicy="no-referrer" />
          : <span className="grid size-12 shrink-0 place-items-center rounded-xl border border-dashed border-line text-muted"><Icon name="plus" size={18} /></span>}
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]; e.target.value = "";
            if (!f) return;
            if (f.size > 512 * 1024) { setErr("The logo must be 512 KB or smaller."); return; }
            setErr(null);
            const fd = new FormData(); fd.set("logo", f);
            start(async () => { const r = await uploadLogo(fd); if (r.url) onChange(r.url); else setErr(r.error ?? "Upload failed."); });
          }} />
        <button type="button" disabled={busy} onClick={() => file.current?.click()}
          className="h-10 rounded-xl border border-line px-3 text-sm font-medium hover:bg-bg disabled:opacity-50">{busy ? "Uploading…" : value ? "Replace" : "Upload logo"}</button>
        {value && <button type="button" onClick={() => onChange("")} className="h-10 rounded-xl px-3 text-sm text-muted hover:bg-bg">Remove</button>}
      </div>
      <Input value={value} maxLength={500} placeholder="…or paste an https:// link" aria-label="Logo link" onChange={(e) => onChange(e.target.value.trim())} />
      <span className="block text-[11px] text-muted">PNG, JPEG or WebP, up to 512 KB. A square crest works best.</span>
      {err && <Notice tone="bad">{err}</Notice>}
    </div>
  );
}
