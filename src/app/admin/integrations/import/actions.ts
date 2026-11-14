"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { documentRows } from "@/lib/doc-rows";
import { autoMap, datasetDef, mappingProblems, mapRows, tableFromJson, TRANSFORMS, unusedColumns, type Mapping } from "@/lib/integrations/datasets";

const NEEDS = "The Import Centre needs the latest database updates (migrations 0025 and 0026).";
const MAX_FILE = 5 * 1024 * 1024, MAX_ROWS = 50_000, CHUNK = 4000;

type Table = { headers: string[]; rows: string[][] };

/** A CSV, Excel or JSON file as a header row and cells. Throws a message fit to show. */
async function readTable(file: File): Promise<Table> {
  if (file.size === 0) throw new Error("That file is empty.");
  if (file.size > MAX_FILE) throw new Error("The file is larger than 5 MB. Split it and import in parts.");
  const name = file.name.toLowerCase();
  if (!/\.(csv|tsv|txt|xlsx|json)$/.test(name)) throw new Error("Use a CSV, Excel (.xlsx) or JSON file.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let t: Table;
  if (name.endsWith(".json")) {
    try { t = tableFromJson(JSON.parse(new TextDecoder().decode(bytes))); }
    catch { throw new Error("That JSON file couldn't be read. It should be a list of records."); }
  } else {
    let rows: string[][];
    try { rows = (await documentRows(file.name, bytes)).rows; }
    catch { throw new Error("That file couldn't be read. Save it as CSV or .xlsx and try again."); }
    const [head = [], ...rest] = rows;
    t = { headers: head.map((h) => String(h ?? "").trim()), rows: rest };
  }
  if (!t.headers.filter(Boolean).length) throw new Error("The first row must name the columns.");
  if (new Set(t.headers.filter(Boolean)).size !== t.headers.filter(Boolean).length) throw new Error("Two columns have the same name. Rename one and upload again.");
  if (!t.rows.length) throw new Error("The file has column names but no rows.");
  if (t.rows.length > MAX_ROWS) throw new Error(`The file has ${t.rows.length.toLocaleString("en-ZA")} rows. Import at most ${MAX_ROWS.toLocaleString("en-ZA")} at a time.`);
  return t;
}

export type Inspected = {
  error?: string; headers?: string[]; sample?: string[][]; total?: number; suggested?: Mapping;
  saved?: { name: string; mapping: Mapping }[];
};

/** Step 1: read the file's columns and a few rows, and suggest a mapping. Nothing is stored. */
export async function inspectFile(f: FormData): Promise<Inspected> {
  const { supabase, institutionId } = await requireRole("institution_admin");
  const ds = datasetDef(String(f.get("dataset") ?? ""));
  const file = f.get("file");
  if (!ds) return { error: "Choose what the file contains." };
  if (!(file instanceof File)) return { error: "Choose a file." };
  let t: Table;
  try { t = await readTable(file); } catch (e) { return { error: (e as Error).message }; }
  const { data: saved } = await supabase.from("integration_mappings").select("name, mapping")
    .eq("institution_id", institutionId).eq("dataset", ds.key).order("updated_at", { ascending: false }).limit(20);
  return { headers: t.headers, sample: t.rows.slice(0, 5).map((r) => r.map((c) => String(c ?? "").slice(0, 80))), total: t.rows.length,
    suggested: autoMap(t.headers, ds), saved: (saved ?? []) as { name: string; mapping: Mapping }[] };
}

const MappingSchema = z.record(z.string().max(40), z.object({
  column: z.string().max(200).optional(), fixed: z.string().max(200).optional(),
  transform: z.enum(Object.keys(TRANSFORMS) as [keyof typeof TRANSFORMS, ...(keyof typeof TRANSFORMS)[]]).optional(),
}));

/**
 * Step 2: apply the mapping, hand the rows to the engine and work out what would
 * happen (new, updated, unchanged, duplicate, rejected). Nothing is imported until
 * the administrator confirms on the next page.
 */
export async function stageImport(_: { error?: string } | undefined, f: FormData): Promise<{ error?: string }> {
  const { supabase, institutionId } = await requireRole("institution_admin");
  const ds = datasetDef(String(f.get("dataset") ?? ""));
  const file = f.get("file");
  if (!ds || !(file instanceof File)) return { error: "Choose the file again." };
  let mapping: Mapping;
  try { mapping = MappingSchema.parse(JSON.parse(String(f.get("mapping") ?? "{}"))) as Mapping; }
  catch { return { error: "The column choices couldn't be read. Reload the page and try again." }; }
  let t: Table;
  try { t = await readTable(file); } catch (e) { return { error: (e as Error).message }; }
  const problems = mappingProblems(ds, mapping, t.headers);
  if (problems.length) return { error: problems.join(" ") };
  const rows = mapRows(t.headers, t.rows, ds, mapping);
  if (!rows.length) return { error: "Every row in the file is empty." };

  const saveAs = String(f.get("save_as") ?? "").trim().slice(0, 80);
  if (saveAs) {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("integration_mappings").upsert(
      { institution_id: institutionId, dataset: ds.key, name: saveAs, mapping, updated_by: user?.id ?? null, updated_at: new Date().toISOString() },
      { onConflict: "institution_id,dataset,name" });
  }

  const unused = unusedColumns(mapping, t.headers);
  const label = `${file.name.slice(0, 120)} · ${ds.label}${unused.length ? ` · not used: ${unused.slice(0, 8).join(", ")}${unused.length > 8 ? "…" : ""}` : ""}`;
  const { data: run, error } = await supabase.rpc("import_start", { p_inst: institutionId, p_source: "file", p_label: label, p_complete: false });
  if (error) return { error: error.code === "PGRST202" ? NEEDS : error.message };
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error: e } = await supabase.rpc("import_add", { p_run: run, p_dataset: ds.key, p_rows: rows.slice(i, i + CHUNK) });
    if (e) { await supabase.rpc("import_cancel", { p_run: run }); return { error: e.message }; }
  }
  const { error: pe } = await supabase.rpc("import_preview", { p_run: run });
  if (pe) { await supabase.rpc("import_cancel", { p_run: run }); return { error: pe.message }; }
  redirect(`/admin/integrations/import/${run}`);
}

type S = { error?: string; ok?: string } | undefined;

/** Step 3: the administrator confirms; the whole import is applied, or none of it. */
export async function confirmImport(_: S, f: FormData): Promise<S> {
  const run = z.string().uuid().safeParse(f.get("run"));
  if (!run.success) return { error: "Unknown import." };
  if (f.get("confirm") !== "on") return { error: "Tick the box to confirm." };
  const { supabase } = await requireRole("institution_admin");
  const { error } = await supabase.rpc("import_commit", { p_run: run.data });
  if (error) return { error: error.message };
  for (const p of ["/admin/integrations/import", "/admin/people", "/admin/modules", "/admin/structure", "/admin/connections"]) revalidatePath(p);
  revalidatePath(`/admin/integrations/import/${run.data}`);
  return { ok: "Imported." };
}

export async function cancelImport(f: FormData): Promise<void> {
  const run = z.string().uuid().safeParse(f.get("run"));
  if (!run.success) return;
  const { supabase } = await requireRole("institution_admin");
  await supabase.rpc("import_cancel", { p_run: run.data });
  revalidatePath("/admin/integrations/import");
  redirect("/admin/integrations/import");
}

export async function deleteMapping(f: FormData): Promise<void> {
  const p = z.object({ dataset: z.string().max(40), name: z.string().max(80) }).safeParse(Object.fromEntries(f));
  if (!p.success) return;
  const { supabase, institutionId } = await requireRole("institution_admin");
  await supabase.from("integration_mappings").delete().eq("institution_id", institutionId).eq("dataset", p.data.dataset).eq("name", p.data.name);
  revalidatePath("/admin/integrations/import");
}
