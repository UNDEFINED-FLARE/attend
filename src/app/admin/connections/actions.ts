"use server";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { ConnectionOptions, rosterFromText } from "@/lib/integrations/roster";
import { kickIntegrations } from "@/lib/integrations/runner";
import { fetchRosterFeed, moodleTest } from "@/lib/integrations/sources";
import { decryptSecret, encryptionReady, encryptSecret, statusFromError, type TestStatus } from "@/lib/integrations/secrets";
import { createClient } from "@supabase/supabase-js";
import { DB_SCHEMA, env } from "@/lib/env";
import { dispatchSecret } from "@/lib/push";

/** Server-to-database client for the steps that need the dispatch secret (never the user's session). */
const serverDb = () => createClient(env.url, env.anonKey, { db: { schema: DB_SCHEMA }, auth: { persistSession: false, autoRefreshToken: false } });

/** Records a real test's result. Only the server holds the secret this needs, so nobody can mark a connection "connected" by hand. */
async function recordTest(id: string, status: TestStatus, message: string) {
  const secret = dispatchSecret();
  if (!secret) return;
  await serverDb().rpc("integration_test_result", { p_secret: secret, p_id: id, p_status: status, p_message: message.slice(0, 300) });
}

type S = { error?: string; ok?: string; key?: string } | undefined;
const NEEDS_0024 = "Connections need the latest database update (migration 0024).";
const on = (f: FormData, k: string) => f.get(k) === "on";

/** Add or change a connection. The address and token are tried first, so a typo is caught here and not at 2 a.m. */
export async function saveConnection(_: S, f: FormData): Promise<S> {
  const p = z.object({
    id: z.string().uuid().optional(),
    kind: z.enum(["moodle", "feed", "api"]),
    name: z.string().trim().min(2, "Give the connection a name.").max(80),
    base_url: z.string().trim().max(500).optional(),
    token: z.string().trim().max(2000).optional(),
    schedule: z.enum(["manual", "hourly", "daily"]).default("daily"),
  }).safeParse({ ...Object.fromEntries(f), id: f.get("id") || undefined });
  if (!p.success) return { error: p.error.issues[0].message };
  const d = p.data;
  const options = ConnectionOptions.parse({
    create_modules: on(f, "create_modules"), drop_missing: on(f, "drop_missing"), trim_course_code: on(f, "trim_course_code"),
    student_number_from: f.get("student_number_from") || undefined, course_code_from: f.get("course_code_from") || undefined,
    provider: f.get("provider") || undefined,
  });
  const url = (d.base_url ?? "").replace(/\/+$/, "");
  let note = "";
  // Who's asking comes first: the test below makes the server contact the address.
  const { supabase, institutionId } = await requireRole("institution_admin");
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
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't reach that address." };
  }

  const { data, error } = await supabase.rpc("save_integration", {
    p_inst: institutionId, p_id: d.id ?? null, p_kind: d.kind, p_name: d.name, p_base_url: d.kind === "api" ? null : url,
    p_token: d.token && d.kind !== "api" ? encryptSecret(d.token) : null, p_options: options, p_schedule: d.schedule,
  });
  if (error) return { error: error.code === "PGRST202" ? NEEDS_0024 : error.message };
  const made = data as { id: string; api_key: string | null };
  if (tested) await recordTest(made.id, tested.status, tested.message);
  revalidatePath("/admin/connections");
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
  const { supabase } = await requireRole("institution_admin");
  const { data, error } = await supabase.rpc("integration_action", { p_id: p.data.id, p_action: p.data.action });
  if (error) return { error: error.code === "PGRST202" ? NEEDS_0024 : error.message };
  revalidatePath("/admin/connections");
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
  const { supabase } = await requireRole("institution_admin");
  // As the administrator: RLS only returns their own institution's connection.
  const { data: c } = await supabase.from("integrations").select("id, kind, base_url").eq("id", id.data).maybeSingle();
  if (!c) return { error: "Unknown connection." };
  if (c.kind === "api") return { ok: "This connection waits for your system to send rosters; there is nothing to call. Its status changes with each roster received." };
  const secret = dispatchSecret();
  if (!secret) return { error: "This server has no PUSH_DISPATCH_SECRET set, so it can't run tests or syncs yet." };
  let status: TestStatus = "connected", message = "";
  try {
    const { data: stored, error } = await serverDb().rpc("integration_secret", { p_secret: secret, p_id: c.id });
    if (error) throw new Error(error.message);
    const token = decryptSecret(stored as string | null);
    if (c.kind === "moodle") {
      if (!token) throw new Error("No token is saved. Edit the connection and paste the Moodle token.");
      const t = await moodleTest(c.base_url!, token);
      if (t.missing.length) { status = "permission_denied"; message = `Connected to ${t.site}, but the service is missing: ${t.missing.join(", ")}.`; }
      else message = `Connected to ${t.site}.`;
    } else {
      const r = await fetchRosterFeed(c.base_url!, token);
      message = `Read ${r.people.length} people in ${r.modules.length} modules.`;
    }
  } catch (e) {
    message = e instanceof Error ? e.message : "The test could not finish.";
    status = statusFromError(message);
  }
  await recordTest(c.id, status, message);
  revalidatePath("/admin/connections");
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
  const { supabase, institutionId } = await requireRole("institution_admin");
  const { data, error } = await supabase.rpc("import_roster", { p_inst: institutionId, p_payload: roster });
  if (error) return { error: error.code === "PGRST202" ? NEEDS_0024 : error.message };
  revalidatePath("/admin/connections"); revalidatePath("/admin/people"); revalidatePath("/admin/modules");
  const r = data as Record<string, number> & { unknown_modules: string[]; errors: { row: number; who: string; error: string }[] };
  const msg = `${r.students_added} students and ${r.lecturers_added} lecturers added, ${r.students_updated + r.lecturers_updated} updated, ${r.enrolments_added} enrolments and ${r.assignments_added} teaching assignments made.`;
  const problems = [
    r.unknown_modules.length ? `Module codes not found: ${r.unknown_modules.slice(0, 10).join(", ")}${r.unknown_modules.length > 10 ? "…" : ""}.` : "",
    r.errors.length ? `${r.skipped} skipped — ${r.errors.slice(0, 6).map((e) => `${e.who}: ${e.error}`).join("; ")}${r.skipped > 6 ? "…" : ""}` : "",
  ].filter(Boolean).join(" ");
  return problems ? { error: `${msg} ${problems}` } : { ok: msg };
}
