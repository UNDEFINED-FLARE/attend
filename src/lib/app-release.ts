// The Android app offered on /app, as described by public/downloads/android.json
// (written by scripts/publish-apk.mjs). Nothing here is secret: it is the same
// file anyone can fetch from the website.

export type AndroidRelease = {
  version: string;
  versionCode: number;
  build: "release" | "test";
  url: string;          // /downloads/… on this site, or an https address elsewhere
  file: string;
  bytes: number;
  sha256: string;
  minAndroid: string;
  publishedAt: string;
};

const s = (v: unknown, max = 200) => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);

/** A release only if every field is sane; anything else means "no download yet". */
export function parseRelease(raw: unknown): AndroidRelease | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const url = s(r.url, 500), file = s(r.file), version = s(r.version, 40), sha = s(r.sha256, 64);
  const bytes = Number(r.bytes), versionCode = Number(r.versionCode);
  if (r.platform !== "android" || !url || !file || !version || !sha) return null;
  if (!/^[0-9a-f]{64}$/.test(sha) || !/^[A-Za-z0-9._-]+\.apk$/.test(file)) return null;
  // Our own static file, or an https address (e.g. a GitHub release or a storage bucket).
  if (!/^\/downloads\/[A-Za-z0-9._-]+\.apk$/.test(url) && !/^https:\/\/[^\s"<>]+$/.test(url)) return null;
  if (!Number.isFinite(bytes) || bytes <= 0 || !Number.isInteger(versionCode) || versionCode < 1) return null;
  return {
    version, versionCode, file, url, bytes, sha256: sha,
    build: r.build === "release" ? "release" : "test",
    minAndroid: s(r.minAndroid, 20) ?? "7.0",
    publishedAt: s(r.publishedAt, 40) ?? "",
  };
}

export const formatBytes = (n: number) =>
  n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} bytes`;
