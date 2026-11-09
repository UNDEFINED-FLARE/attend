"use client";
import { useMemo, useState } from "react";
import { Button, Input, Notice } from "@/components/ui";
import type { ParsedClass } from "@/lib/timetable-pdf";
import { fetchSourceBatch, listSourceItems, previewClasses, type ImportPreview } from "./import-actions";
import { ImportReview } from "./pdf-import";

type Item = { id: string; label: string; group?: string };
const BATCH = { viewer_json: 8, pdf_links: 4, pdf_url: 1, none: 1 } as const;

/**
 * Collect classes from the institution's own timetable source, set up by
 * UniAttend: programmes from a timetable viewer, or PDF timetables from the
 * institution's timetable pages. Fetched a batch at a time from the browser,
 * so no single request runs long and the admin sees progress.
 */
export function SourceImport({ sourceLabel }: { sourceLabel: string }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [type, setType] = useState<keyof typeof BATCH>("none");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const noun = type === "viewer_json" ? "programme" : "timetable";

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (items ?? []).filter((c) => !f || c.label.toLowerCase().includes(f) || (c.group ?? "").toLowerCase().includes(f));
  }, [items, filter]);

  async function load() {
    setError(null); setBusy("Reading your timetable source…");
    const r = await listSourceItems();
    setBusy(null);
    if (r.error) { setError(r.error); return; }
    setItems(r.items ?? []); setType(r.type ?? "none");
    if (r.items?.length === 1) setPicked(new Set([r.items[0].id]));
  }

  async function fetchAll() {
    const ids = [...picked];
    if (!ids.length) return;
    setError(null); setPreview(null); setFailed([]);
    const byId = new Map(items!.map((c) => [c.id, c.label]));
    const classes = new Map<string, ParsedClass>();
    const failedIds: string[] = [];
    const n = BATCH[type];
    for (let i = 0; i < ids.length; i += n) {
      setBusy(`Collecting timetables… ${Math.min(i + n, ids.length)} of ${ids.length}`);
      try {
        const r = await fetchSourceBatch(ids.slice(i, i + n));
        for (const c of r.classes) classes.set(c.sourceId != null ? String(c.sourceId) : `${c.code}|${c.weekday}|${c.starts_at}|${c.ends_at}|${c.venue}`, c);
        failedIds.push(...r.failed);
      } catch {
        failedIds.push(...ids.slice(i, i + n));
      }
    }
    setFailed(failedIds.map((id) => byId.get(id) ?? id));
    if (!classes.size) { setBusy(null); setError(`No classes were found in those ${noun}s.`); return; }
    setBusy("Comparing with your modules and venues…");
    const title = ids.length === 1 ? byId.get(ids[0]) ?? "Timetable" : `${ids.length} ${noun}s from ${sourceLabel}`;
    const p = await previewClasses(JSON.stringify([...classes.values()]), title);
    setBusy(null);
    if (p?.error) setError(p.error); else if (p?.preview) setPreview(p.preview);
  }

  if (!items) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">Collect classes from your institution&apos;s timetable source, <b>{sourceLabel}</b>. Nothing is saved until you confirm.</p>
        <Button type="button" variant="secondary" onClick={load} disabled={!!busy}>{busy ?? `Load ${noun}s`}</Button>
        {error && <Notice tone="bad">{error}</Notice>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!preview && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Filter ${noun}s`} className="h-9 max-w-xs" aria-label={`Filter ${noun}s`} />
            <button type="button" className="h-9 rounded-xl border border-line px-3 text-sm hover:bg-bg"
              onClick={() => setPicked((p) => new Set([...p, ...shown.map((c) => c.id)]))}>Select {filter ? "shown" : "all"} ({shown.length})</button>
            <button type="button" className="h-9 rounded-xl border border-line px-3 text-sm hover:bg-bg" onClick={() => setPicked(new Set())}>Clear</button>
            <span className="text-sm text-muted">{picked.size} selected of {items.length}</span>
          </div>
          <div className={`grid max-h-72 gap-1 overflow-y-auto rounded-xl border border-line p-2 ${type === "viewer_json" ? "grid-cols-2 sm:grid-cols-4 lg:grid-cols-6" : "sm:grid-cols-2"}`}>
            {shown.map((c) => (
              <label key={c.id} className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-bg" title={c.group ? `${c.group} · ${c.label}` : c.label}>
                <input type="checkbox" className="size-4 shrink-0" checked={picked.has(c.id)}
                  onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(c.id); else n.delete(c.id); return n; })} />
                <span className="truncate">{type === "viewer_json" ? <span className="font-mono">{c.label}</span> : <>{c.group && <span className="text-muted">{c.group} · </span>}{c.label}</>}</span>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={fetchAll} disabled={!picked.size || !!busy}>{busy ?? `Collect ${picked.size || ""} ${noun}${picked.size === 1 ? "" : "s"}`}</Button>
            {picked.size > 30 && !busy && <span className="text-xs text-muted">This can take a few minutes; timetable sites answer slowly.</span>}
          </div>
        </>
      )}
      {error && <Notice tone="bad">{error}</Notice>}
      {failed.length > 0 && <Notice tone="warn">Couldn&apos;t read {failed.length} {noun}{failed.length > 1 ? "s" : ""} (not included): {failed.slice(0, 6).join(", ")}{failed.length > 6 ? "…" : ""}.</Notice>}
      {preview && (
        <>
          <button type="button" className="text-sm text-accent" onClick={() => setPreview(null)}>← Choose different {noun}s</button>
          <ImportReview key={preview.classes.length} preview={preview} />
        </>
      )}
    </div>
  );
}
