import "server-only";
import { extractPdfItems, parseTimetableItems, type ParsedClass } from "@/lib/timetable-pdf";
import { assertPublicHttps } from "@/lib/url-safety";
import { eventToClass, type ViewerEvent } from "@/lib/viewer-events";

export { assertPublicHttps };

// Where an institution's timetable is collected from. Set per institution by
// the platform administrator (uniattend.institution_settings):
//   viewer_json — a timetable viewer with a JSON API: {base}/api/courses and
//                 {base}/api/timetable/course/{id}
//   pdf_links   — a web page that links to PDF timetables, directly or through
//                 its sub-pages (one level deep)
//   pdf_url     — a single PDF timetable
//
// Every request goes through safeFetch: https only, no private or internal
// addresses (checked after DNS resolution, and again on every redirect), a
// timeout and a size cap. The URL comes from the platform administrator, but
// this keeps a mistyped or hostile address from reaching internal services.

export type SourceType = "none" | "viewer_json" | "pdf_links" | "pdf_url";
export type SourceItem = { id: string; label: string; group?: string };

const UA = "UniAttend timetable import (attendance platform)";
const MAX_HTML = 3 * 1024 * 1024, MAX_PDF = 8 * 1024 * 1024, MAX_JSON = 8 * 1024 * 1024;

/** fetch with the checks above, re-applied on every redirect, a timeout, and a size cap. */
async function safeFetch(url: string, maxBytes: number, accept: string): Promise<{ body: Uint8Array; url: string; type: string }> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicHttps(current);
    const r = await fetch(current, { headers: { "User-Agent": UA, Accept: accept }, redirect: "manual", signal: AbortSignal.timeout(25_000), cache: "no-store" });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
      current = new URL(r.headers.get("location")!, current).toString();
      continue;
    }
    if (!r.ok) throw new Error(`The timetable site answered ${r.status}.`);
    if (Number(r.headers.get("content-length") ?? 0) > maxBytes) throw new Error("That file is too large.");
    const reader = r.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = reader ? await reader.read() : { done: true, value: undefined };
      if (done) break;
      size += value!.byteLength;
      if (size > maxBytes) { await reader!.cancel(); throw new Error("That file is too large."); }
      chunks.push(value!);
    }
    const body = new Uint8Array(size);
    let o = 0;
    for (const c of chunks) { body.set(c, o); o += c.byteLength; }
    return { body, url: current, type: r.headers.get("content-type") ?? "" };
  }
  throw new Error("Too many redirects.");
}

const text = (b: Uint8Array) => new TextDecoder().decode(b);

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch { await new Promise((r) => setTimeout(r, 800)); return fn(); }
}

/** Run `fn` over items with at most `n` at a time. */
async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    for (let x = queue.shift(); x !== undefined; x = queue.shift()) await fn(x);
  }));
}

// ----------------------------------------------------------- viewer_json

function viewerBase(url: string) {
  return url.replace(/\/+$/, "").replace(/\/api$/, "") + "/api";
}

async function viewerCatalog(base: string): Promise<SourceItem[]> {
  const list = JSON.parse(text((await withRetry(() => safeFetch(`${viewerBase(base)}/courses`, MAX_JSON, "application/json"))).body)) as { courseId: number; name: string }[];
  return list.filter((c) => Number.isInteger(c.courseId) && c.name).map((c) => ({ id: String(c.courseId), label: c.name.trim() }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

async function viewerClasses(base: string, ids: string[]) {
  const byEvent = new Map<number, ParsedClass>();
  const failed: string[] = [];
  await pool(ids, 4, async (id) => {
    if (!/^\d{1,9}$/.test(id)) { failed.push(id); return; }
    try {
      const j = JSON.parse(text((await withRetry(() => safeFetch(`${viewerBase(base)}/timetable/course/${id}`, MAX_JSON, "application/json"))).body)) as { events: ViewerEvent[] };
      for (const e of j.events ?? []) {
        const c = eventToClass(e);
        if (c && !byEvent.has(e.eventId)) byEvent.set(e.eventId, c);
      }
    } catch { failed.push(id); }
  });
  return { classes: [...byEvent.values()], failed };
}

// ------------------------------------------------------------- pdf_links

/** Links in an HTML page, absolute, with their text. */
function links(html: string, base: string): { href: string; label: string }[] {
  const out: { href: string; label: string }[] = [];
  for (const m of html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const href = new URL(m[1].replace(/&amp;/g, "&"), base).toString();
      const label = m[2].replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
      out.push({ href, label });
    } catch { /* skip malformed */ }
  }
  return out;
}
/** Same site, ignoring a leading "www." (sites link both ways). */
const sameSite = (a: string, b: string) => a.replace(/^www\./, "") === b.replace(/^www\./, "");
const isPdf = (u: string) => /\.pdf($|\?)/i.test(new URL(u).pathname + new URL(u).search);
const pdfLabel = (href: string, label: string) => label || decodeURIComponent(new URL(href).pathname.split("/").pop() ?? href).replace(/\.pdf$/i, "").replace(/[_-]+/g, " ");

async function pdfCatalog(indexUrl: string): Promise<SourceItem[]> {
  const index = await withRetry(() => safeFetch(indexUrl, MAX_HTML, "text/html"));
  const root = new URL(index.url);
  const found = new Map<string, SourceItem>();
  const add = (href: string, label: string, group?: string) => {
    if (!sameSite(new URL(href).host, root.host) || found.has(href)) return;
    found.set(href, { id: href, label: pdfLabel(href, label), group });
  };
  const top = links(text(index.body), index.url);
  for (const l of top) if (isPdf(l.href)) add(l.href, l.label);
  // One level of sub-pages on the same site, under the index's own path.
  const prefix = root.pathname.replace(/\/?$/, "/");
  const subpages = [...new Map(top.filter((l) => !isPdf(l.href)).map((l) => [l.href.split("#")[0], l])).values()]
    .filter((l) => { const u = new URL(l.href); return sameSite(u.host, root.host) && u.pathname.startsWith(prefix) && u.pathname !== root.pathname; })
    .slice(0, 40);
  await pool(subpages, 4, async (p) => {
    try {
      const page = await safeFetch(p.href, MAX_HTML, "text/html");
      for (const l of links(text(page.body), page.url)) if (isPdf(l.href)) add(l.href, l.label, p.label || undefined);
    } catch { /* a broken sub-page shouldn't stop the rest */ }
  });
  // Index pages usually also link calendars and policies; when the sub-pages hold the
  // timetables, keep only those.
  const all = [...found.values()];
  const grouped = all.filter((i) => i.group);
  return (grouped.length ? grouped : all).sort((a, b) => (a.group ?? "").localeCompare(b.group ?? "") || a.label.localeCompare(b.label));
}

async function pdfClasses(urls: string[], sourceHost: string | null) {
  const classes: ParsedClass[] = [];
  const failed: string[] = [];
  await pool(urls, 3, async (u) => {
    try {
      if (sourceHost && !sameSite(new URL(u).host, sourceHost)) throw new Error("other site");
      const r = await withRetry(() => safeFetch(u, MAX_PDF, "application/pdf"));
      if (String.fromCharCode(...r.body.slice(0, 5)) !== "%PDF-") throw new Error("not a PDF");
      const parsed = parseTimetableItems(await extractPdfItems(r.body));
      classes.push(...parsed.classes);
      if (!parsed.classes.length) failed.push(u);
    } catch { failed.push(u); }
  });
  // The same class appears in several programmes' PDFs.
  const seen = new Set<string>();
  return {
    classes: classes.filter((c) => { const k = [c.code, c.weekday, c.starts_at, c.ends_at, c.venue ?? "online"].join("|"); return !seen.has(k) && !!seen.add(k); }),
    failed,
  };
}

// -------------------------------------------------------------- public API

/** What can be imported from this source: programmes (viewer) or PDF files. */
export async function sourceCatalog(type: SourceType, url: string): Promise<SourceItem[]> {
  if (type === "viewer_json") return viewerCatalog(url);
  if (type === "pdf_links") return pdfCatalog(url);
  if (type === "pdf_url") { await assertPublicHttps(url); return [{ id: url, label: pdfLabel(url, "") }]; }
  return [];
}

/** Classes for some of the catalogue's items. Failed items are returned, not thrown. */
export async function sourceClasses(type: SourceType, url: string, ids: string[]): Promise<{ classes: ParsedClass[]; failed: string[] }> {
  if (type === "viewer_json") return viewerClasses(url, ids);
  if (type === "pdf_links" || type === "pdf_url") return pdfClasses(type === "pdf_url" ? [url] : ids, new URL(url).host);
  return { classes: [], failed: ids };
}
