import "server-only";
import { assertPublicHttps } from "@/lib/url-safety";
import { rosterFromText, type MoodleCourse, type MoodleUser, type Roster } from "./roster";

// Talking to an institution's own systems. Every request: https only, public
// addresses only (checked after DNS resolution and on each redirect), a timeout
// and a size cap. Tokens travel in the request body or a header, never in a URL,
// and are never logged or returned.

const UA = "UniAttend roster sync";
const MAX_BYTES = 25 * 1024 * 1024;

async function request(url: string, init: { method: "GET" | "POST"; headers?: Record<string, string>; body?: string }, what: string): Promise<{ text: string; type: string }> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicHttps(current, what);
    const r = await fetch(current, { ...init, headers: { "User-Agent": UA, ...init.headers }, redirect: "manual", signal: AbortSignal.timeout(30_000), cache: "no-store" });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
      const next = new URL(r.headers.get("location")!, current);
      // Never carry a token to another site.
      if (next.host !== new URL(current).host) throw new Error(`${what} sent us to a different site (${next.host}). Use its exact address.`);
      current = next.toString();
      continue;
    }
    if (r.status === 401 || r.status === 403) throw new Error(`${what} refused access (${r.status}). Check the token.`);
    if (!r.ok) throw new Error(`${what} answered ${r.status}.`);
    if (Number(r.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error(`${what} sent more than 25 MB.`);
    const reader = r.body?.getReader();
    if (!reader) return { text: "", type: r.headers.get("content-type") ?? "" };
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error(`${what} sent more than 25 MB.`); }
      chunks.push(value);
    }
    return { text: new TextDecoder().decode(Buffer.concat(chunks)), type: r.headers.get("content-type") ?? "" };
  }
  throw new Error(`${what} redirected too many times.`);
}

// ------------------------------------------------------------ Moodle web services

const MOODLE_HELP: Record<string, string> = {
  invalidtoken: "Moodle didn't accept the token. Create a new one under Site administration → Server → Web services → Manage tokens.",
  accessexception: "The token's user isn't allowed to do this. Give the web-service user permission to view courses and participants.",
  webservicefunctionnotavailable: "The Moodle service linked to this token is missing a function.",
  servicenotavailable: "Web services are switched off in Moodle (Site administration → Advanced features).",
};

async function moodle<T>(base: string, token: string, fn: string, params: Record<string, string> = {}): Promise<T> {
  const body = new URLSearchParams({ wstoken: token, wsfunction: fn, moodlewsrestformat: "json", ...params }).toString();
  const { text } = await request(`${base.replace(/\/+$/, "")}/webservice/rest/server.php`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body }, "Moodle");
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error("That address didn't answer like Moodle. Use your Moodle site's address, e.g. https://moodle.example.ac.za"); }
  const err = data as { exception?: string; errorcode?: string; message?: string } | null;
  if (err && typeof err === "object" && "exception" in err) {
    throw new Error(MOODLE_HELP[err.errorcode ?? ""] ?? `Moodle said: ${String(err.message ?? err.errorcode ?? "error").slice(0, 200)}${fn ? ` (${fn})` : ""}`);
  }
  return data as T;
}

export const MOODLE_FUNCTIONS = ["core_webservice_get_site_info", "core_course_get_courses", "core_enrol_get_enrolled_users"] as const;

/** Checks the address and token, and that the service allows what the sync needs. */
export async function moodleTest(base: string, token: string): Promise<{ site: string; missing: string[] }> {
  const info = await moodle<{ sitename?: string; functions?: { name: string }[] }>(base, token, "core_webservice_get_site_info");
  const have = new Set((info.functions ?? []).map((f) => f.name));
  return { site: info.sitename ?? "Moodle", missing: MOODLE_FUNCTIONS.filter((f) => !have.has(f)) };
}

export async function moodleCourses(base: string, token: string): Promise<MoodleCourse[]> {
  const all = await moodle<MoodleCourse[]>(base, token, "core_course_get_courses");
  // id 1 is the site itself.
  return (Array.isArray(all) ? all : []).filter((c) => c.id > 1).sort((a, b) => a.id - b.id);
}

export async function moodleEnrolled(base: string, token: string, courseId: number): Promise<MoodleUser[]> {
  const users = await moodle<MoodleUser[]>(base, token, "core_enrol_get_enrolled_users", {
    courseid: String(courseId),
    "options[0][name]": "userfields", "options[0][value]": "id,username,fullname,email,idnumber,roles",
    "options[1][name]": "onlyactive", "options[1][value]": "1",
  });
  return Array.isArray(users) ? users : [];
}

// ------------------------------------------------------------ roster link

/** A CSV or JSON roster at an https address; the optional token is sent as a Bearer header. */
export async function fetchRosterFeed(url: string, token: string | null): Promise<Roster> {
  const { text, type } = await request(url, { method: "GET", headers: { Accept: "text/csv, application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } }, "The roster link");
  if (!text.trim()) throw new Error("The roster link returned an empty file.");
  if (/^\s*<(!doctype|html)/i.test(text)) throw new Error("The roster link returned a web page, not a CSV or JSON file. It may need a sign-in.");
  try { return rosterFromText(text, type); }
  catch { throw new Error("The roster file couldn't be read. Use CSV with a header row, or JSON as described on the Connections page."); }
}
