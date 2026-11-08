// Only public values live here. The service-role key is never read by the app:
// privileged work happens in SECURITY DEFINER functions and Edge Functions.
function required(name: string, value: string | undefined) {
  if (!value) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return value;
}

/** UniAttend's own Postgres schema; it shares the Supabase project with other apps. */
export const DB_SCHEMA = "uniattend";

export const env = {
  get url() {
    return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  },
  get anonKey() {
    return required("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  },
  get siteUrl() {
    return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  },
};
