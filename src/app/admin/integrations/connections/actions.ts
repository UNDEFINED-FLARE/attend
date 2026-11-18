"use server";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { INTEGRATION_ROLES, requireAnyRole } from "@/lib/auth";
import { DB_SCHEMA, env } from "@/lib/env";
import { RestConfig, rosterOf } from "@/lib/integrations/rest";
import { ConnectionOptions, rosterFromText } from "@/lib/integrations/roster";
import { kickIntegrations } from "@/lib/integrations/runner";
import { decryptSecret, encryptionReady, encryptSecret, statusFromError, type TestStatus } from "@/lib/integrations/secrets";
import { fetchRosterFeed, moodleTest, readRest } from "@/lib/integrations/sources";
import { dispatchSecret } from "@/lib/push";

/** Server-to-database client for the steps that need the dispatch secret (never the user's session). */
const serverDb = () => createClient(env.url, env.anonKey, { db: { schema: DB_SCHEMA }, auth: { persistSession: false, autoRefreshToken: false } });

/** Records a real test's result. Only the server holds the secret this needs, so nobody can mark a connection "connected" by hand. */
async function recordTest(id: string, status: TestStatus, message: string) {
  const secret = dispatchSecret();
  if (!secret) return;
  await serverDb().rpc("integration_test_result", { p_secret: secret, p_id: id, p_status: status, p_message: message.slice(0, 300) });
}

/** A connection's stored credential, decrypted in memory for a test. */
async function storedSecret(id: string): Promise<string | null> {
  const secret = dispatchSecret();
  if (!secret) throw new Error("This server has no PUSH_DISPATCH_SECRET set, so it can't run tests or syncs yet.");
  const { data, error } = await serverDb().rpc("integration_secret", { p_secret: secret, p_id: id });
  if (error) throw new Error(error.message);
  return decryptSecret(data as string | null);
}

type S = { error?: string; ok?: string; key?: string } | undefined;
const NEEDS = "Connections need the latest database update (migration 0035 for API connections).";
const on = (f: FormData, k: string) => f.get(k) === "on";
const refresh = (id?: string) => {
  revalidatePath("/admin/integrations");
  if (id) revalidatePath(`/admin/integrations/connections/${id}`);
};

/** The API connector's settings from the form (fields named rest_*). */
function restFromForm(f: FormData) {
  const g = (k: string) => (f.get(`rest_${k}`) ?? undefined) as string | undefined;
  return RestConfig.safeParse({
    records: g("records"), auth: g("auth"), header_name: g("header_name"), token_url: g("token_url"), client_id: g("client_id"), scope: g("scope"),
    paging: g("paging"), page_param: g("page_param"), size_param: g("size_param"), page_size: g("page_size"), first_page: g("first_page"),
    offset_param: g("offset_param"), limit_param: g("limit_param"), next_path: g("next_path"), max_pages: g("max_pages"),
    map: {
      role: g("map_role"), role_default: g("map_role_default"), number: g("map_number"), full_name: g("map_full_name"),
      first_name: g("map_first_name"), last_name: g("map_last_name"), email: g("map_email"), module_codes: g("map_module_codes"),
      module_title: g("map_module_title"),
    },
  });
}

/** Read the first page of an API and describe what it holds, or throw why not. */
async function tryRest(url: string, cfg: RestConfig, secret: string | null): Promise<string> {
  let records: unknown[] = [];
  await readRest(url, cfg, secret, { keepGoing: () => false, onPage: (r) => { records = r; } });
  if (!records.length) throw new Error("The API answered, but its first page has no records. Check where the records are, and that the account can see them.");
  const { roster, skipped } = rosterOf(records, cfg.map);
  if (!roster.people.length) throw new Error(`The first page has ${records.length} records, but none has a value at “${cfg.map.number}” (number) or “${cfg.map.email}” (email). Check the field mapping.`);
  const p = roster.people[0];
  const noModules = roster.people.every((x) => !x.module_codes.length);
  if (noModules) throw new Error(`People were found, but nobody has a module code at “${cfg.map.module_codes}”. Check the module code field.`);
  return `Read ${records.length} records on the first page: ${roster.people.length} people in ${roster.modules.length} modules`
    + `${skipped ? ` (${skipped} records named nobody)` : ""}. First: ${p.full_name || p.number} (${p.role}, ${p.number || p.email}) in ${p.module_codes.slice(0, 3).join(", ")}.`;
}

/** Add or change a connection. The address and credentials are tried first, so a typo is caught here and not at 2 a.m. */
export async function saveConnection(_: S, f: FormData): Promise<S> {
  const p = z.object({
    id: z.string().uuid().optional(),
    kind: z.enum(["moodle", "feed", "api", "rest"]),
    name: z.string().trim().min(2, "Give the connection a name.").max(80),
    base_url: z.string().trim().max(500).optional(),
    token: z.string().trim().max(2000).optional(),
    schedule: z.enum(["manual", "hourly", "daily"]).default("daily"),
  }).safeParse({ ...Object.fromEntries(f), id: f.get("id") || undefined });
  if (!p.success) return { error: p.error.issues[0].message };
  const d = p.data;
  const base = ConnectionOptions.parse({
    create_modules: on(f, "create_modules"), drop_missing: on(f, "drop_missing"), trim_course_code: on(f, "trim_course_code"),
    student_number_from: f.get("student_number_from") || undefined, course_code_from: f.get("course_code_from") || undefined,
    provider: f.get("provider") || undefined,
  });
  let rest: RestConfig | undefined;
  if (d.kind === "rest") {
    const r = restFromForm(f);
    if (!r.success) return { error: r.error.issues[0].message };
    rest = r.data;
    if (rest.auth === "oauth2" && (!rest.token_url || !rest.client_id)) return { error: "For OAuth, enter the token address and the client ID." };
  }
  const options = rest ? { ...base, rest } : base;
  // For the API connector the address is the first page, as entered; for the others a trailing slash is dropped.
  const url = d.kind === "rest" ? (d.base_url ?? "") : (d.base_url ?? "").replace(/\/+$/, "");
  let note = "";
  // Who's asking comes first: the test below makes the server contact the address.
  const { supabase, institutionId } = await requireAnyRole(INTEGRATION_ROLES);
  if (d.token && d.kind !== "api" && !encryptionReady()) {
    return { error: "This server can't store credentials safely yet: set INTEGRATION_ENCRYPTION_KEY in Vercel's environment variables, redeploy, then save again." };
  }
  let tested: { status: TestStatus; message: string } | null = null;

  try {
    if (d.kind === "moodle" && d.token) {
      const t = await moodleTest(url, d.token);
      if (t.missing.length) return { error: `Connected to ${t.site}, but the token's service is missing: ${t.missing.join(", ")}. Add these functions to the service in Moodle, then save again.` };
      note = ` Connected to ${t.site}.`;
      tested = { status: "connected", message: `Connected to ${t.site}.` };
    } else if (d.kind === "moodle" && !d.id) {
      return { error: "Paste the Moodle web-service token." };
    } else if (d.kind === "feed" && (d.token || !d.id)) {
      const r = await fetchRosterFeed(url, d.token || null);
      if (!r.people.length) return { error: "The link works, but the file lists nobody. Check its columns: role, number, full_name, email, module_code." };
      note = ` The file lists ${r.people.length.toLocaleString("en-ZA")} people in ${r.modules.length} modules.`;
      tested = { status: "connected", message: `Read ${r.people.length} people in ${r.modules.length} modules.` };
    } else if (d.kind === "rest" && rest) {
      // A new connection, or new settings: always test, with the new credential or the stored one.
      if (rest.auth !== "none" && !d.token && !d.id) return { error: rest.auth === "oauth2" ? "Enter the client secret." : "Enter the key or token." };
      const secret = rest.auth === "none" ? null : d.token || (d.id ? await storedSecret(d.id) : null);
      const message = await tryRest(url, rest, secret);
      note = ` ${message}`;
      tested = { status: "connected", message };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't reach that address." };
  }

  const { data, error } = await supabase.rpc("save_integration", {
    p_inst: institutionId, p_id: d.id ?? null, p_kind: d.kind, p_name: d.name, p_base_url: d.kind === "api" ? null : url,
    p_token: d.token && d.kind !== "api" ? encryptSecret(d.token) : null, p_options: options, p_schedule: d.schedule,
  });
  if (error) return { error: error.code === "PGRST202" || /unknown connection type|kind_check/.test(error.message) ? NEEDS : error.message };
  const made = data as { id: string; api_key: string | null };
  if (tested) await recordTest(made.id, tested.status, tested.message);
  refresh(made.id);
  if (made.api_key) return { ok: "Connection created. Copy the key now: it is shown only once.", key: made.api_key };
  if (!d.id && d.kind !== "api") {
    await supabase.rpc("integration_action", { p_id: made.id, p_action: "sync" });
    after(kickIntegrations);
    return { ok: `Saved.${note} The first sync has started; refresh in a minute to see the result.` };
  }
  return { ok: `Saved.${note}` };
}

export async function connectionAction(_: S, f: FormData): Promise<S> {
  const p = z.object({ id: z.string().uuid(), action: z.enum(["sync", "pause", "resume", "delete", "new_key"]) }).safeParse(Object.fromEntries(f));
  if (!p.success) return { error: "Unknown action." };
  if (p.data.action === "delete" && f.get("confirm") !== "on") return { error: "Tick the box to confirm." };
  const { supabase } = await requireAnyRole(INTEGRATION_ROLES);
  const { data, error } = await supabase.rpc("integration_action", { p_id: p.data.id, p_action: p.data.action });
  if (error) return { error: error.code === "PGRST202" ? NEEDS : error.message };
  refresh(p.data.id);
  const key = (data as { api_key: string | null } | null)?.api_key;
  if (key) return { ok: "New key created; the old one no longer works. Copy it now: it is shown only once.", key };
  if (p.data.action === "sync") {
    if (!dispatchSecret()) return { ok: "Queued. (This server has no PUSH_DISPATCH_SECRET set, so syncs can't run yet.)" };
    after(kickIntegrations);
    return { ok: "Sync started. Refresh in a minute to see the result." };
  }
  return { ok: { pause: "Paused.", resume: "Resumed.", delete: "Connection removed. People and enrolments it loaded are kept." }[p.data.action as "pause" | "resume" | "delete"] };
}

/** "Test connection": the server signs in to the source with the stored credentials and makes a harmless read. */
export async function testConnection(_: S, f: FormData): Promise<S> {
  const id = z.string().uuid().safeParse(f.get("id"));
  if (!id.success) return { error: "Unknown connection." };
  const { supabase } = await requireAnyRole(INTEGRATION_ROLES);
  // As the administrator: RLS only returns their own institution's connection.
  const { data: c } = await supabase.from("integrations").select("id, kind, base_url, options").eq("id", id.data).maybeSingle();
  if (!c) return { error: "Unknown connection." };
  if (c.kind === "api") return { ok: "This connection waits for your system to send rosters; there is nothing to call. Its status changes with each roster received." };
  let status: TestStatus = "connected", message = "";
  try {
    const token = await storedSecret(c.id);
    if (c.kind === "moodle") {
      if (!token) throw new Error("No token is saved. Edit the connection and paste the Moodle token.");
      const t = await moodleTest(c.base_url!, token);
      if (t.missing.length) { status = "permission_denied"; message = `Connected to ${t.site}, but the service is missing: ${t.missing.join(", ")}.`; }
      else message = `Connected to ${t.site}.`;
    } else if (c.kind === "rest") {
      const cfg = RestConfig.parse((c.options as { rest?: unknown } | null)?.rest ?? {});
      message = await tryRest(c.base_url!, cfg, token);
    } else {
      const r = await fetchRosterFeed(c.base_url!, token);
      message = `Read ${r.people.length} people in ${r.modules.length} modules.`;
    }
  } catch (e) {
    message = e instanceof Error ? e.message : "The test could not finish.";
    status = statusFromError(message);
  }
  await recordTest(c.id, status, message);
  refresh(c.id);
  return status === "connected" ? { ok: message } : { error: message };
}

/** A roster file uploaded by hand: students and lecturers with their modules, in one go. */
export async function uploadRoster(_: S, f: FormData): Promise<S> {
  const file = f.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV or JSON file." };
  if (file.size > 10 * 1024 * 1024) return { error: "The file is larger than 10 MB. Split it and upload in parts." };
  let roster;
  try { roster = rosterFromText(await file.text(), /\.json$/i.test(file.name) ? "application/json" : "text/csv"); }
  catch { return { error: "The file couldn't be read. Use CSV with a header row: role, number, full_name, email, module_code." }; }
  if (!roster.people.length) return { error: "No people found. The first row must name the columns: role, number, full_name, email, module_code." };
  if (roster.people.length > 20000) return { error: "Upload at most 20,000 people at a time." };
  const { supabase, institutionId } = await requireAnyRole(INTEGRATION_ROLES);
  const { data, error } = await supabase.rpc("import_roster", { p_inst: institutionId, p_payload: roster });
  if (error) return { error: error.code === "PGRST202" ? NEEDS : error.message };
  refresh(); revalidatePath("/admin/integrations/import"); revalidatePath("/admin/people"); revalidatePath("/admin/modules");
  const r = data as Record<string, number> & { unknown_modules: string[]; errors: { row: number; who: string; error: string }[] };
  const msg = `${r.students_added} students and ${r.lecturers_added} lecturers added, ${r.students_updated + r.lecturers_updated} updated, ${r.enrolments_added} enrolments and ${r.assignments_added} teaching assignments made.`;
  const problems = [
    r.unknown_modules.length ? `Module codes not found: ${r.unknown_modules.slice(0, 10).join(", ")}${r.unknown_modules.length > 10 ? "…" : ""}.` : "",
    r.errors.length ? `${r.skipped} skipped — ${r.errors.slice(0, 6).map((e) => `${e.who}: ${e.error}`).join("; ")}${r.skipped > 6 ? "…" : ""}` : "",
  ].filter(Boolean).join(" ");
  return problems ? { error: `${msg} ${problems}` } : { ok: msg };
}
