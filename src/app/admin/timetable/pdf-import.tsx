"use client";
import { useActionState, useMemo } from "react";
import { Submit } from "@/components/form";
import { Icon } from "@/components/icons";
import { Badge, Input, Notice } from "@/components/ui";
import { DAYS, moduleColor } from "@/components/week-grid";
import { applyTimetableImport, previewTimetablePdf, type ImportPreview, type PreviewState } from "./import-actions";

type S = { error?: string; ok?: string } | undefined;

export function PdfImport() {
  const [state, preview] = useActionState(previewTimetablePdf, undefined as PreviewState);
  return (
    <div className="space-y-4">
      <form action={preview} className="space-y-3">
        <p className="text-sm text-muted">
          Upload a timetable exported from the university timetable system (PDF). You&apos;ll see every class it found before anything is saved.
        </p>
        <div className="flex flex-wrap gap-2">
          <Input type="file" name="file" accept="application/pdf,.pdf" required className="max-w-sm py-1.5" />
          <Submit label="Read timetable" pending="Reading PDF…" variant="secondary" />
        </div>
        {state?.error && <Notice tone="bad">{state.error}</Notice>}
      </form>
      {state?.preview && <ImportReview key={state.preview.classes.length + (state.preview.title ?? "")} preview={state.preview} />}
    </div>
  );
}

/** Shared preview + confirm step for every timetable source. */
export function ImportReview({ preview: p }: { preview: ImportPreview }) {
  const [result, apply] = useActionState(applyTimetableImport, undefined as S);
  const byDay = useMemo(() => {
    const m = new Map<number, ImportPreview["classes"]>();
    for (const c of p.classes) m.set(c.weekday, [...(m.get(c.weekday) ?? []), c]);
    return [...m].sort((a, b) => a[0] - b[0]);
  }, [p]);
  const newVen = new Set(p.newVenues), newMod = new Set(p.newModules);
  const lecturerTotal = Object.keys(p.lecturers).length;
  const lecturerKnown = Object.values(p.lecturers).filter(Boolean).length;
  const SHOW = 400; // a full university is thousands of rows; the list is a sample, the import is everything

  if (result?.ok) return <Notice tone="ok">{result.ok} Students enrolled in these modules see the classes now.</Notice>;

  return (
    <form action={apply} className="space-y-4 rounded-2xl border border-line p-4">
      <input type="hidden" name="classes" value={JSON.stringify(p.classes)} />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">{p.title ?? "Timetable"}: {p.classes.length.toLocaleString()} classes found</p>
        {p.expected != null && (
          <p className="text-xs text-muted">
            The file says {p.expected} events{p.expected > p.classes.length ? `; ${p.expected - p.classes.length} were exact repeats and are counted once` : ""}.
          </p>
        )}
      </div>
      {p.warnings.length > 0 && <Notice tone="warn">{p.warnings.join(" ")}</Notice>}

      <div className="grid gap-2 text-sm sm:grid-cols-3">
        <Summary icon="book" label="Modules" value={new Set(p.classes.map((c) => c.code)).size} sub={p.newModules.length ? `${p.newModules.length} new` : "all exist"} />
        <Summary icon="building" label="Venues" value={new Set(p.classes.map((c) => c.venue).filter(Boolean)).size} sub={p.newVenues.length ? `${p.newVenues.length} new` : "all exist"} />
        <Summary icon="user" label="Lecturers" value={lecturerTotal} sub={`${lecturerKnown} already registered`} />
      </div>

      <div className="max-h-96 overflow-y-auto rounded-xl border border-line">
        {byDay.map(([day, list]) => (
          <div key={day}>
            <p className="sticky top-0 bg-bg px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted">{DAYS[day]} · {list.length}</p>
            <ul className="divide-y divide-line">
              {list.slice(0, Math.ceil(SHOW / byDay.length)).map((c, i) => (
                <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  <span className="w-24 tabular-nums text-muted">{c.starts_at}–{c.ends_at}</span>
                  <span className="w-20 font-semibold" style={{ color: moduleColor(c.code) }}>{c.code}</span>
                  {newMod.has(c.code) && <Badge status="pending">new module</Badge>}
                  <span className="min-w-32 flex-1">{c.online ? <span className="text-info">Online</span> : c.venue}{c.group ? <span className="text-muted"> · {c.group}</span> : null}</span>
                  {c.venue && newVen.has(c.venue) && <Badge status="pending">new venue</Badge>}
                  <span className="w-full truncate text-xs text-muted sm:w-auto">{c.lecturer ?? ""}</span>
                </li>
              ))}
              {list.length > Math.ceil(SHOW / byDay.length) && (
                <li className="px-3 py-2 text-xs text-muted">…and {list.length - Math.ceil(SHOW / byDay.length)} more on {DAYS[day]}, all included in the import.</li>
              )}
            </ul>
          </div>
        ))}
      </div>

      <fieldset className="grid gap-2 text-sm sm:grid-cols-2">
        <Option name="create_modules" on label="Create missing modules" hint={p.newModules.length ? `${p.newModules.length}: ${p.newModules.slice(0, 8).join(", ")}${p.newModules.length > 8 ? "…" : ""}` : "None missing"} />
        <Option name="create_venues" on label="Create missing venues" hint={p.newVenues.length ? `${p.newVenues.length} venues; map them afterwards for GPS checks` : "None missing"} />
        <Option name="create_lecturers" on label="Create missing lecturers" hint={lecturerTotal - lecturerKnown ? `${lecturerTotal - lecturerKnown} named in the timetable; add their staff numbers and emails later` : "None missing"} />
        <Option name="assign_lecturers" on label="Link lecturers to their modules and classes" hint={`${lecturerTotal} lecturers in this timetable`} />
        <Option name="module_sizes" on label="Update module class sizes" hint="From the timetable's group sizes, where it gives them" />
        <Option name="replace" label="Replace these modules' current timetable" hint="Removes their existing classes first. Leave off to only add new ones." />
      </fieldset>
      {result?.error && <Notice tone="bad">{result.error}</Notice>}
      <Submit label={`Create ${p.classes.length.toLocaleString()} classes`} pending="Creating classes…" />
    </form>
  );
}

function Summary({ icon, label, value, sub }: { icon: Parameters<typeof Icon>[0]["name"]; label: string; value: number; sub: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-bg p-3">
      <span className="grid size-9 place-items-center rounded-lg bg-surface text-muted"><Icon name={icon} size={18} /></span>
      <span><b className="text-base">{value.toLocaleString()}</b> <span className="text-muted">{label}</span><br /><span className="text-xs text-muted">{sub}</span></span>
    </div>
  );
}

function Option({ name, label, hint, on }: { name: string; label: string; hint: string; on?: boolean }) {
  return (
    <label className="flex items-start gap-2 rounded-xl border border-line p-3">
      <input type="checkbox" name={name} defaultChecked={on} className="mt-0.5 size-4" />
      <span><span className="block font-medium">{label}</span><span className="text-xs text-muted">{hint}</span></span>
    </label>
  );
}
