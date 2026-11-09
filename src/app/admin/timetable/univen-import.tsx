"use client";
import { useMemo, useState } from "react";
import { Button, Input, Notice } from "@/components/ui";
import type { ParsedClass } from "@/lib/timetable-pdf";
import type { UnivenCourse } from "@/lib/univen-timetable";
import { fetchUnivenBatch, listUnivenCourses, previewClasses, type ImportPreview } from "./import-actions";
import { ImportReview } from "./pdf-import";

const BATCH = 8;

/**
 * Pull timetables straight from timetable.univen.ac.za. Programmes are
 * fetched a batch at a time from the browser's side, so no single server
 * request runs long and the admin sees progress.
 */
export function UnivenImport() {
  const [courses, setCourses] = useState<UnivenCourse[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [failed, setFailed] = useState<string[]>([]);

  const shown = useMemo(() => (courses ?? []).filter((c) => c.name.toLowerCase().includes(filter.trim().toLowerCase())), [courses, filter]);

  async function load() {
    setError(null); setBusy("Loading programmes…");
    const r = await listUnivenCourses();
    setBusy(null);
    if (r.error) setError(r.error); else setCourses(r.courses ?? []);
  }

  async function fetchAll() {
    const ids = [...picked];
    if (!ids.length) return;
    setError(null); setPreview(null); setFailed([]);
    const byId = new Map(courses!.map((c) => [c.id, c.name]));
    const classes = new Map<string, ParsedClass>();
    const failedIds: number[] = [];
    for (let i = 0; i < ids.length; i += BATCH) {
      setBusy(`Fetching timetables… ${Math.min(i + BATCH, ids.length)} of ${ids.length} programmes`);
      try {
        const r = await fetchUnivenBatch(ids.slice(i, i + BATCH));
        for (const c of r.classes) classes.set(String(c.sourceId ?? `${c.code}|${c.weekday}|${c.starts_at}|${c.venue}`), c);
        failedIds.push(...r.failed);
      } catch {
        failedIds.push(...ids.slice(i, i + BATCH));
      }
    }
    setFailed(failedIds.map((id) => byId.get(id) ?? String(id)));
    if (!classes.size) { setBusy(null); setError("No classes were returned for those programmes."); return; }
    setBusy("Comparing with your modules and venues…");
    const title = ids.length === 1 ? byId.get(ids[0]) ?? "Programme" : `${ids.length} programmes from timetable.univen.ac.za`;
    const p = await previewClasses(JSON.stringify([...classes.values()]), title);
    setBusy(null);
    if (p?.error) setError(p.error); else if (p?.preview) setPreview(p.preview);
  }

  if (!courses) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">
          Read classes directly from the university&apos;s public timetable site, <a className="text-accent underline" href="https://timetable.univen.ac.za" target="_blank" rel="noreferrer">timetable.univen.ac.za</a>.
          Nothing is saved until you confirm.
        </p>
        <Button type="button" variant="secondary" onClick={load} disabled={!!busy}>{busy ?? "Load programmes"}</Button>
        {error && <Notice tone="bad">{error}</Notice>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!preview && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter programmes, e.g. AGB or MSB" className="h-9 max-w-xs" aria-label="Filter programmes" />
            <button type="button" className="h-9 rounded-xl border border-line px-3 text-sm hover:bg-bg"
              onClick={() => setPicked((p) => new Set([...p, ...shown.map((c) => c.id)]))}>Select {filter ? "shown" : "all"} ({shown.length})</button>
            <button type="button" className="h-9 rounded-xl border border-line px-3 text-sm hover:bg-bg" onClick={() => setPicked(new Set())}>Clear</button>
            <span className="text-sm text-muted">{picked.size} selected of {courses.length}</span>
          </div>
          <div className="grid max-h-64 grid-cols-2 gap-1 overflow-y-auto rounded-xl border border-line p-2 sm:grid-cols-4 lg:grid-cols-6">
            {shown.map((c) => (
              <label key={c.id} className="flex items-center gap-2 rounded-md px-2 py-1 font-mono text-xs hover:bg-bg">
                <input type="checkbox" className="size-4" checked={picked.has(c.id)}
                  onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(c.id); else n.delete(c.id); return n; })} />
                {c.name}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={fetchAll} disabled={!picked.size || !!busy}>{busy ?? `Fetch ${picked.size || ""} timetable${picked.size === 1 ? "" : "s"}`}</Button>
            {picked.size > 40 && !busy && <span className="text-xs text-muted">About {Math.ceil(picked.size / BATCH) * 6} seconds; the site answers slowly.</span>}
          </div>
        </>
      )}
      {error && <Notice tone="bad">{error}</Notice>}
      {failed.length > 0 && <Notice tone="warn">These programmes could not be fetched and are not included: {failed.join(", ")}. Fetch them again later.</Notice>}
      {preview && (
        <>
          <button type="button" className="text-sm text-accent" onClick={() => setPreview(null)}>← Choose different programmes</button>
          <ImportReview key={preview.classes.length} preview={preview} />
        </>
      )}
    </div>
  );
}
