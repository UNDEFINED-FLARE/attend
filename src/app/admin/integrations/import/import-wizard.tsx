"use client";
import { useActionState, useMemo, useRef, useState, useTransition } from "react";
import { Submit } from "@/components/form";
import { Field, Input, Notice, Select } from "@/components/ui";
import { applyTransform, DATASETS, datasetDef, mappingProblems, TRANSFORMS, unusedColumns, type DatasetKey, type Mapping, type Transform } from "@/lib/integrations/datasets";
import { inspectFile, stageImport, type Inspected } from "./actions";

const STEPS = ["Choose file", "Match columns", "Check and import"];

/** Upload → match the file's columns to UniAttend's fields → preview. The file stays in the browser until step 2 is submitted. */
export function ImportWizard() {
  const [dataset, setDataset] = useState<DatasetKey>("students");
  const [info, setInfo] = useState<Inspected | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const [staged, stage] = useActionState(stageImport, undefined);
  const ds = datasetDef(dataset)!;

  const inspect = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) { setErr("Choose a file."); return; }
    setErr(null);
    const fd = new FormData(); fd.set("file", file); fd.set("dataset", dataset);
    start(async () => {
      const r = await inspectFile(fd);
      if (r.error) { setErr(r.error); return; }
      setInfo(r); setMapping(r.suggested ?? {});
    });
  };
  const set = (key: string, v: Partial<Mapping[string]>) => setMapping((m) => {
    const next = { ...(m[key] ?? {}), ...v };
    if (!next.column) delete next.column;
    if (!next.fixed) delete next.fixed;
    if (!next.transform || next.transform === "none") delete next.transform;
    const out = { ...m };
    if (Object.keys(next).length) out[key] = next; else delete out[key];
    return out;
  });

  const headers = useMemo(() => info?.headers ?? [], [info]);
  const problems = useMemo(() => (info ? mappingProblems(ds, mapping, headers) : []), [info, ds, mapping, headers]);
  const unused = useMemo(() => (info ? unusedColumns(mapping, headers) : []), [info, mapping, headers]);
  const first = info?.sample?.[0];
  const example = (key: string) => {
    const m = mapping[key];
    if (!m) return "";
    const raw = m.column && first ? first[headers.indexOf(m.column)] ?? "" : "";
    return applyTransform((raw || m.fixed || "").trim(), m.transform);
  };
  const step = info ? 1 : 0;

  return (
    <div className="space-y-5">
      <ol className="flex flex-wrap gap-2 text-xs font-semibold">
        {STEPS.map((s, i) => (
          <li key={s} className={`rounded-full px-3 py-1 ${i === step ? "bg-brand text-brand-ink" : i < step ? "bg-ok/15 text-ok" : "bg-bg text-muted"}`}>{i + 1}. {s}</li>
        ))}
      </ol>

      <form action={stage} className="space-y-5">
        {/* Step 1 stays mounted so the chosen file is submitted with step 2. */}
        <div className={info ? "hidden" : "space-y-4"}>
          <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
            <Field label="What does the file contain?">
              <Select name="dataset" value={dataset} onChange={(e) => setDataset(e.target.value as DatasetKey)}>
                {DATASETS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
              </Select>
            </Field>
            <Field label="File" hint="CSV, Excel (.xlsx) or JSON, up to 5 MB and 50,000 rows. The first row names the columns.">
              <Input ref={fileRef} name="file" type="file" accept=".csv,.tsv,.txt,.xlsx,.json" />
            </Field>
          </div>
          <p className="text-sm text-muted">{ds.about}{ds.needs ? ` ${ds.needs}` : ""}</p>
          {err && <Notice tone="bad">{err}</Notice>}
          <button type="button" onClick={inspect} disabled={busy} className="h-10 rounded-xl bg-brand px-4 text-sm font-semibold text-brand-ink disabled:opacity-60">
            {busy ? "Reading…" : "Read the file"}
          </button>
        </div>

        {info && (
          <>
            <input type="hidden" name="mapping" value={JSON.stringify(mapping)} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm"><b>{info.total?.toLocaleString("en-ZA")}</b> rows of <b>{ds.label.toLowerCase()}</b> · {headers.length} columns</p>
              <button type="button" className="text-sm font-medium text-accent" onClick={() => { setInfo(null); setMapping({}); }}>Choose a different file</button>
            </div>

            {(info.saved?.length ?? 0) > 0 && (
              <Field label="Use a saved matching">
                <Select defaultValue="" onChange={(e) => { const s = info.saved!.find((x) => x.name === e.target.value); if (s) setMapping(s.mapping); }} className="sm:w-80">
                  <option value="" disabled>Choose…</option>
                  {info.saved!.map((s) => <option key={s.name}>{s.name}</option>)}
                </Select>
              </Field>
            )}

            <div className="-mx-5 overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-2 font-medium">UniAttend field</th><th className="px-2 py-2 font-medium">Column in your file</th>
                  <th className="px-2 py-2 font-medium">Tidy up</th><th className="px-2 py-2 font-medium">Or the same for every row</th><th className="px-5 py-2 font-medium">First row becomes</th>
                </tr></thead>
                <tbody className="divide-y divide-line">
                  {ds.fields.map((f) => (
                    <tr key={f.key}>
                      <td className="px-5 py-2 align-top"><span className="font-medium">{f.label}</span>{f.required && <span className="text-bad"> *</span>}
                        {f.hint && <span className="block max-w-56 text-xs text-muted">{f.hint}</span>}</td>
                      <td className="px-2 py-2 align-top">
                        <Select aria-label={`Column for ${f.label}`} value={mapping[f.key]?.column ?? ""} onChange={(e) => set(f.key, { column: e.target.value })} className="h-9 w-44">
                          <option value="">Not in the file</option>
                          {headers.filter(Boolean).map((h) => <option key={h}>{h}</option>)}
                        </Select>
                      </td>
                      <td className="px-2 py-2 align-top">
                        <Select aria-label={`Tidy up ${f.label}`} value={mapping[f.key]?.transform ?? "none"} onChange={(e) => set(f.key, { transform: e.target.value as Transform })} className="h-9 w-40">
                          {Object.entries(TRANSFORMS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </Select>
                      </td>
                      <td className="px-2 py-2 align-top"><Input aria-label={`Fixed value for ${f.label}`} value={mapping[f.key]?.fixed ?? ""} onChange={(e) => set(f.key, { fixed: e.target.value })} maxLength={200} className="h-9 w-36" /></td>
                      <td className="max-w-48 truncate px-5 py-2 align-top font-mono text-xs">{example(f.key) || <span className="text-muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {unused.length > 0 && <Notice tone="info">Not imported, because nothing uses {unused.length === 1 ? "this column" : "these columns"}: {unused.join(", ")}.</Notice>}
            {problems.map((p) => <Notice key={p} tone="warn">{p}</Notice>)}

            <Field label="Remember this matching as (optional)" hint="Next time a file has the same columns, pick it from the list.">
              <Input name="save_as" maxLength={80} placeholder="ITS student export" className="sm:w-80" />
            </Field>
            {staged?.error && <Notice tone="bad">{staged.error}</Notice>}
            <div className="flex flex-wrap items-center gap-3">
              <Submit label="Check the file" pending="Checking every row…" />
              <span className="text-xs text-muted">Nothing is imported yet. You&apos;ll see exactly what would change first.</span>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
