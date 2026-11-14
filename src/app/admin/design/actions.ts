"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { env } from "@/lib/env";
import { parseTheme, ThemeSchema, type Theme } from "@/lib/theme";

type S = { error?: string; ok?: string; at?: string } | undefined;
const NEEDS_0019 = "Drafts and version history need the latest database update: run supabase/migrations/20261112000019_theme_versions_branding.sql in the Supabase SQL Editor.";

function read(f: FormData): { theme?: Theme; error?: string } {
  let parsed;
  try { parsed = ThemeSchema.safeParse(JSON.parse(String(f.get("theme") ?? "{}"))); }
  catch { return { error: "The design could not be read. Reload the page and try again." }; }
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { error: `${i.path.join(" › ")}: ${i.message}` };
  }
  return { theme: parsed.data };
}

/** Publish: everyone at the institution sees it, and it is kept in the version history. */
export async function publishTheme(_: S, f: FormData): Promise<S> {
  const { theme, error: bad } = read(f);
  if (!theme) return { error: bad };
  const { supabase, institutionId } = await requireRole("institution_admin");
  const note = String(f.get("note") ?? "").trim().slice(0, 120) || null;
  const { error } = await supabase.rpc("publish_theme", { p_institution: institutionId, p_theme: theme, p_note: note });
  if (error?.code === "PGRST202") {
    // Before migration 0019: publish straight away, without history.
    const { error: e2 } = await supabase.from("institutions").update({ theme, brand_primary: theme.colors.primary }).eq("id", institutionId);
    if (e2) return { error: e2.message };
  } else if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: "Published. Everyone at your institution sees it now." };
}

/** Keep work in progress without changing what anyone else sees. */
export async function saveThemeDraft(_: S, f: FormData): Promise<S> {
  const { theme, error: bad } = read(f);
  if (!theme) return { error: bad };
  const { supabase, institutionId } = await requireRole("institution_admin");
  const { data, error } = await supabase.rpc("save_theme_draft", { p_institution: institutionId, p_theme: theme });
  if (error) return { error: error.code === "PGRST202" ? NEEDS_0019 : error.message };
  revalidatePath("/admin/design");
  return { ok: "Draft saved. Only administrators see it until you publish.", at: String(data) };
}

export async function discardThemeDraft(): Promise<S> {
  const { supabase, institutionId } = await requireRole("institution_admin");
  const { error } = await supabase.rpc("discard_theme_draft", { p_institution: institutionId });
  if (error) return { error: error.code === "PGRST202" ? NEEDS_0019 : error.message };
  revalidatePath("/admin/design");
  return { ok: "Draft discarded." };
}

/** A saved version, to load into the editor (it is only live once published again). */
export async function loadThemeVersion(versionId: string): Promise<{ theme?: Theme; error?: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(versionId)) return { error: "Unknown version." };
  const { supabase, institutionId } = await requireRole("institution_admin");
  const { data, error } = await supabase.from("theme_versions").select("theme").eq("id", versionId).eq("institution_id", institutionId).maybeSingle();
  if (error || !data) return { error: error?.message ?? "That version no longer exists." };
  return { theme: parseTheme(data.theme) };
}

const MAX_LOGO = 512 * 1024;
const SIGNATURES: [string, string, (b: Uint8Array) => boolean][] = [
  ["image/png", "png", (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47],
  ["image/jpeg", "jpg", (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ["image/webp", "webp", (b) => String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP"],
];

/** Upload a logo to the institution's folder in Storage and return its public address. */
export async function uploadLogo(f: FormData): Promise<{ url?: string; error?: string }> {
  const file = f.get("logo");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an image first." };
  if (file.size > MAX_LOGO) return { error: "The logo must be 512 KB or smaller." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Trust the file's content, not its name: PNG, JPEG or WebP only (no SVG, which can carry scripts).
  const kind = SIGNATURES.find(([, , is]) => is(bytes));
  if (!kind) return { error: "Use a PNG, JPEG or WebP image." };
  const { supabase, institutionId } = await requireRole("institution_admin");
  const path = `${institutionId}/logo-${Date.now()}.${kind[1]}`;
  const { error } = await supabase.storage.from("branding").upload(path, bytes, { contentType: kind[0], cacheControl: "31536000", upsert: false });
  if (error) {
    return { error: /bucket not found/i.test(error.message) ? `Logo upload needs the latest database update. ${NEEDS_0019.split(": ")[1]}` : error.message };
  }
  return { url: `${env.url}/storage/v1/object/public/branding/${path}` };
}
