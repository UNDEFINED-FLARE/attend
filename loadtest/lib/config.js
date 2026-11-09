// Shared configuration and the production guard for every UniAttend k6 script.
//
// Everything comes from environment variables (k6 -e NAME=value or the shell
// environment). Nothing here has a production default, and the guard below
// aborts the test in the init stage if any target looks like production.

export const PROD_SUPABASE_REFS = ["rbnnbmduwrvokhbkezyh"];
export const PROD_HOSTS = [
  "attend-seven-liart.vercel.app",
  "attend-blueflare.vercel.app",
  "attend-git-main-blueflare.vercel.app",
];

export function env(name, fallback) {
  const v = __ENV[name];
  if (v === undefined || v === "") {
    if (fallback === undefined) throw new Error(`Missing required environment variable ${name}. See loadtest/README.md.`);
    return fallback;
  }
  return v;
}

export function int(name, fallback) {
  const n = parseInt(env(name, String(fallback)), 10);
  if (!Number.isFinite(n)) throw new Error(`${name} must be an integer`);
  return n;
}

function hostOf(url) {
  const m = /^https?:\/\/([^/:]+)/i.exec(url || "");
  return m ? m[1].toLowerCase() : "";
}

/** Throws (which aborts k6 before any request) unless every target is clearly staging. */
export function assertStaging(urls) {
  if (env("LOADTEST_CONFIRM", "") !== "staging") {
    throw new Error("Refusing to run: set LOADTEST_CONFIRM=staging to confirm the targets are a staging environment.");
  }
  const extra = env("PROD_DENYLIST", "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (const url of urls.filter(Boolean)) {
    const host = hostOf(url);
    if (!host) throw new Error(`Not an http(s) URL: ${url}`);
    if (!/^https:\/\//i.test(url) && !/^(localhost|127\.0\.0\.1)$/.test(host)) {
      throw new Error(`Use https for remote targets: ${url}`);
    }
    for (const ref of PROD_SUPABASE_REFS) {
      if (host.includes(ref)) throw new Error(`Refusing to run: ${url} is the PRODUCTION Supabase project (${ref}).`);
    }
    for (const h of [...PROD_HOSTS, ...extra]) {
      if (host === h || host.endsWith("." + h)) throw new Error(`Refusing to run: ${url} is a PRODUCTION host (${h}).`);
    }
  }
}

/** The Supabase project ref of a https://<ref>.supabase.co URL (used for the auth cookie name). */
export function supabaseRef(url) {
  const host = hostOf(url);
  return env("SUPABASE_REF", host.split(".")[0]);
}

export const SUMMARY_STATS = ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max", "count"];

/** Extra headers for a protected Vercel staging deployment (Automation Bypass). */
export function vercelHeaders() {
  const bypass = env("VERCEL_BYPASS", "");
  return bypass ? { "x-vercel-protection-bypass": bypass } : {};
}
