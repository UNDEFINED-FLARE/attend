// The public sign-in directory (sign_in_directory(), migration 0036): which
// institutions a visitor can choose, and the way in each one offers. Pure helpers,
// shared by the sign-in pages and their tests.

export type SignInMethod = "sso" | "email" | "none";

export type DirectoryEntry = {
  slug: string;
  name: string;
  short_name?: string;
  logo?: string;
  campuses?: string[];
  method: SignInMethod;
  /** The Supabase Auth provider ('custom:<name>'), only when method is "sso". */
  provider?: string;
  provider_name?: string;
  scopes?: string;
};

export const SLUG = /^[a-z0-9][a-z0-9-]{1,40}$/;

/** Entries from the database, keeping only well-formed ones (the page never trusts shape). */
export function parseDirectory(data: unknown): DirectoryEntry[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((d) => {
    if (!d || typeof d !== "object") return [];
    const e = d as Record<string, unknown>;
    if (typeof e.slug !== "string" || !SLUG.test(e.slug) || typeof e.name !== "string") return [];
    const method: SignInMethod = e.method === "sso" && typeof e.provider === "string" && /^custom:[a-z0-9][a-z0-9-]{1,40}$/.test(e.provider) ? "sso"
      : e.method === "email" ? "email" : "none";
    return [{
      slug: e.slug, name: e.name, method,
      ...(typeof e.short_name === "string" ? { short_name: e.short_name } : {}),
      ...(typeof e.logo === "string" && e.logo.startsWith("https://") ? { logo: e.logo } : {}),
      ...(Array.isArray(e.campuses) ? { campuses: e.campuses.filter((c): c is string => typeof c === "string") } : {}),
      ...(method === "sso" ? { provider: e.provider as string, provider_name: typeof e.provider_name === "string" ? e.provider_name : "your university account",
        scopes: typeof e.scopes === "string" ? e.scopes : "openid profile email" } : {}),
    }];
  });
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Institutions matching what was typed: every word must appear in the name, short
 * name, slug or a campus. Names that start with the search come first.
 */
export function searchDirectory(list: DirectoryEntry[], query: string): DirectoryEntry[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  const hay = (e: DirectoryEntry) => fold([e.name, e.short_name ?? "", e.slug, ...(e.campuses ?? [])].join(" "));
  const starts = (e: DirectoryEntry) => fold(e.name).startsWith(words[0]) || fold(e.short_name ?? "").startsWith(words[0]);
  return list.filter((e) => words.every((w) => hay(e).includes(w)))
    .sort((a, b) => Number(starts(b)) - Number(starts(a)));
}
