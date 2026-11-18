import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { codesOf, pageUrl, personOf, pick, recordsOf, RestConfig, resumable, rosterOf } from "@/lib/integrations/rest";

// The network side runs against a simulated server: fetch is replaced, and the
// public-address check (DNS) is skipped, so no request leaves the machine.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/url-safety", () => ({ assertPublicHttps: async (u: string) => new URL(u) }));

const cfg = (over: Record<string, unknown> = {}) => RestConfig.parse({ map: { number: "number", module_codes: "modules" }, ...over });

describe("reading records", () => {
  it("follows dot paths into objects and lists", () => {
    const body = { data: { items: [{ code: "A" }, { code: "B" }] } };
    expect(pick(body, "data.items.1.code")).toBe("B");
    expect(pick(body, "")).toBe(body);
    expect(pick(body, "data.missing.deeper")).toBeUndefined();
    expect(pick(null, "x")).toBeUndefined();
  });

  it("finds the list, or says where it looked", () => {
    expect(recordsOf([1, 2], { records: "" })).toEqual([1, 2]);
    expect(recordsOf({ data: [1] }, { records: "data" })).toEqual([1]);
    expect(() => recordsOf({ data: {} }, { records: "data" })).toThrow(/no list at “data”/);
    expect(() => recordsOf({ data: [] }, { records: "" })).toThrow(/not a list/);
  });

  it("reads module codes from lists, objects and text", () => {
    expect(codesOf(["csc1541", "MAT1541", "csc1541"])).toEqual(["CSC1541", "MAT1541"]);
    expect(codesOf([{ code: "CSC1541" }, { module_code: "PHY1A" }])).toEqual(["CSC1541", "PHY1A"]);
    expect(codesOf("CSC1541; MAT1541 | PHY1541,")).toEqual(["CSC1541", "MAT1541", "PHY1541"]);
    expect(codesOf(null)).toEqual([]);
  });

  it("maps a record to a person, with the role from a field or the default", () => {
    const m = cfg({ map: { number: "student.no", module_codes: "modules", role: "type", first_name: "first", last_name: "last", email: "mail" } }).map;
    expect(personOf({ student: { no: 22012345 }, type: "Student", first: "Thabo", last: "Nkosi", mail: "T@Example.ac.za", modules: "CSC1541" }, m))
      .toEqual({ role: "student", number: "22012345", full_name: "Thabo Nkosi", email: "t@example.ac.za", module_codes: ["CSC1541"] });
    expect(personOf({ student: { no: "E1" }, type: "Instructor", modules: [] }, m)?.role).toBe("lecturer");
    expect(personOf({ student: { no: "E1" }, modules: [] }, { ...m, role: "", role_default: "lecturer" })?.role).toBe("lecturer");
    expect(personOf({ type: "student", modules: ["CSC1541"] }, m)).toBeNull();
  });

  it("merges one-row-per-module records into people, and counts the unusable ones", () => {
    const m = cfg({ map: { number: "number", module_codes: "code", module_title: "title", full_name: "name" } }).map;
    const { roster, skipped } = rosterOf([
      { number: "1", name: "A", code: "CSC1541", title: "Programming 1" },
      { number: "1", name: "A", code: "MAT1541", title: "Maths 1" },
      { number: "2", name: "B", code: "CSC1541", title: "" },
      { name: "nobody" },
    ], m);
    expect(skipped).toBe(1);
    expect(roster.people.map((p) => [p.number, p.module_codes])).toEqual([["1", ["CSC1541", "MAT1541"]], ["2", ["CSC1541"]]]);
    expect(roster.modules).toEqual([{ code: "CSC1541", title: "Programming 1" }, { code: "MAT1541", title: "Maths 1" }]);
  });

  it("refuses a mapping without the number or the module codes", () => {
    expect(RestConfig.safeParse({ map: { number: "", module_codes: "m" } }).success).toBe(false);
    expect(RestConfig.safeParse({ map: { number: "n", module_codes: "" } }).success).toBe(false);
    expect(RestConfig.safeParse({ map: { number: "n; drop", module_codes: "m" } }).success).toBe(false);
  });
});

describe("pages", () => {
  const base = "https://sis.example.ac.za/api/people?active=1";

  it("reads one page when there is no paging", () => {
    const c = cfg();
    expect(pageUrl(base, c, 0)).toBe(base);
    expect(pageUrl(base, c, 1, { count: 5, body: [], link: null })).toBeNull();
    expect(resumable(c)).toBe(false);
  });

  it("numbers pages from the first page, keeps the query, and stops at a short page", () => {
    const c = cfg({ paging: "page", page_size: 2, first_page: 0, page_param: "p", size_param: "n" });
    expect(pageUrl(base, c, 0)).toBe("https://sis.example.ac.za/api/people?active=1&p=0&n=2");
    expect(pageUrl(base, c, 3)).toContain("p=3");
    expect(pageUrl(base, c, 1, { count: 2, body: [], link: null })).toContain("p=1");
    expect(pageUrl(base, c, 1, { count: 1, body: [], link: null })).toBeNull();
    expect(resumable(c)).toBe(true);
  });

  it("counts offsets in page sizes", () => {
    const c = cfg({ paging: "offset", page_size: 50 });
    expect(pageUrl(base, c, 2)).toBe("https://sis.example.ac.za/api/people?active=1&offset=100&limit=50");
  });

  it("follows a next link from the body or the Link header, relative or absolute", () => {
    const c = cfg({ paging: "next", next_path: "links.next" });
    expect(pageUrl(base, c, 1, { count: 9, body: { links: { next: "/api/people?cursor=abc" } }, link: null })).toBe("https://sis.example.ac.za/api/people?cursor=abc");
    expect(pageUrl(base, c, 1, { count: 9, body: { links: { next: null } }, link: null })).toBeNull();
    const h = cfg({ paging: "next" });
    expect(pageUrl(base, h, 1, { count: 9, body: {}, link: '<https://sis.example.ac.za/api/people?page=2>; rel="next", <https://sis.example.ac.za/api/people?page=9>; rel="last"' }))
      .toBe("https://sis.example.ac.za/api/people?page=2");
    expect(resumable(h)).toBe(false);
  });

  it("never goes past the most pages allowed", () => {
    const c = cfg({ paging: "page", max_pages: 3 });
    expect(pageUrl(base, c, 3)).toBeNull();
  });
});

// ------------------------------------------------------------ against a simulated server

type Call = { url: string; method: string; headers: Record<string, string>; body: string };
let calls: Call[];
function serve(handler: (url: URL, call: Call) => { status?: number; json?: unknown; text?: string; headers?: Record<string, string> }) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit) => {
    const call: Call = { url: String(input), method: String(init.method), headers: (init.headers ?? {}) as Record<string, string>, body: String(init.body ?? "") };
    calls.push(call);
    const r = handler(new URL(call.url), call);
    const text = r.text ?? JSON.stringify(r.json);
    return new Response(text, { status: r.status ?? 200, headers: { "content-type": "application/json", ...r.headers } });
  }));
}
const sources = () => import("@/lib/integrations/sources");
beforeEach(() => { calls = []; });
afterEach(() => { vi.unstubAllGlobals(); });

describe("reading a university's API", () => {
  const people = Array.from({ length: 5 }, (_, i) => ({ number: String(i + 1), modules: ["CSC1541"] }));

  it("reads page after page until a short page, signing in with a bearer token", async () => {
    serve((u) => {
      const p = Number(u.searchParams.get("page"));
      return { json: { data: people.slice((p - 1) * 2, p * 2) } };
    });
    const { readRest } = await sources();
    const seen: unknown[] = [];
    const res = await readRest("https://sis.example.ac.za/api/people", cfg({ records: "data", paging: "page", page_size: 2 }), "tok", { onPage: (r) => { seen.push(...r); } });
    expect(seen).toHaveLength(5);
    expect(res).toEqual({ next: 3, finished: true, pages: 3 });
    expect(calls.every((c) => c.headers.Authorization === "Bearer tok")).toBe(true);
    // The token never travels in the address.
    expect(calls.some((c) => c.url.includes("tok"))).toBe(false);
  });

  it("stops when time runs out and says where to carry on", async () => {
    serve((u) => ({ json: { data: people.slice(Number(u.searchParams.get("page")) - 1, Number(u.searchParams.get("page"))) } }));
    const { readRest } = await sources();
    let pages = 0;
    const res = await readRest("https://sis.example.ac.za/api/people", cfg({ records: "data", paging: "page", page_size: 1 }), "tok",
      { keepGoing: () => pages < 2, onPage: () => { pages++; } });
    expect(res).toEqual({ next: 2, finished: false, pages: 2 });
    const more = await readRest("https://sis.example.ac.za/api/people", cfg({ records: "data", paging: "page", page_size: 1 }), "tok",
      { start: res.next, onPage: () => { pages++; } });
    expect(more.finished).toBe(true);
    expect(pages).toBe(6); // five people, then the empty page that ends it
  });

  it("is not finished when it reaches the most pages allowed", async () => {
    serve(() => ({ json: [{ number: "1", modules: "CSC1541" }] }));
    const { readRest } = await sources();
    const res = await readRest("https://sis.example.ac.za/api/people", cfg({ paging: "page", page_size: 1, max_pages: 2, auth: "none" }), null, { onPage: () => {} });
    expect(res).toEqual({ next: 2, finished: false, pages: 2 });
  });

  it("follows next links", async () => {
    serve((u) => u.searchParams.get("cursor") === "b"
      ? { json: { items: [people[2]], next: null } }
      : { json: { items: people.slice(0, 2), next: "?cursor=b" } });
    const { readRest } = await sources();
    let n = 0;
    const res = await readRest("https://sis.example.ac.za/api/people", cfg({ records: "items", paging: "next", next_path: "next", auth: "none" }), null, { onPage: (r) => { n += r.length; } });
    expect(n).toBe(3);
    expect(res.finished).toBe(true);
    expect(calls[1].url).toBe("https://sis.example.ac.za/api/people?cursor=b");
    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it("sends an API key in the header it is told to", async () => {
    serve(() => ({ json: [] }));
    const { readRest } = await sources();
    await readRest("https://sis.example.ac.za/api/people", cfg({ auth: "header", header_name: "X-Campus-Key" }), "k1", { onPage: () => {} });
    expect(calls[0].headers["X-Campus-Key"]).toBe("k1");
  });

  it("gets an OAuth token first, with the secret in the body", async () => {
    serve((u) => u.pathname === "/oauth2/token" ? { json: { access_token: "at-1", expires_in: 3600 } } : { json: [] });
    const { readRest } = await sources();
    await readRest("https://sis.example.ac.za/api/people",
      cfg({ auth: "oauth2", token_url: "https://login.example.ac.za/oauth2/token", client_id: "uniattend", scope: "roster.read" }), "s3cret", { onPage: () => {} });
    expect(calls[0].method).toBe("POST");
    const form = new URLSearchParams(calls[0].body);
    expect(Object.fromEntries(form)).toEqual({ grant_type: "client_credentials", client_id: "uniattend", client_secret: "s3cret", scope: "roster.read" });
    expect(calls[1].headers.Authorization).toBe("Bearer at-1");
  });

  it("explains a token address that gives no token", async () => {
    serve(() => ({ json: { error: "invalid_client" } }));
    const { oauthToken } = await sources();
    await expect(oauthToken(cfg({ auth: "oauth2", token_url: "https://login.example.ac.za/t", client_id: "x" }), "bad")).rejects.toThrow(/didn't return an access token/);
    await expect(oauthToken(cfg({ auth: "oauth2" }), "x")).rejects.toThrow(/token address and the client ID/);
  });

  it("explains refusals, non-JSON answers and a missing secret", async () => {
    const { readRest } = await sources();
    serve(() => ({ status: 401, json: {} }));
    await expect(readRest("https://sis.example.ac.za/api", cfg(), "t", { onPage: () => {} })).rejects.toThrow(/refused access \(401\)/);
    serve(() => ({ text: "<html>login</html>", headers: { "content-type": "text/html" } }));
    await expect(readRest("https://sis.example.ac.za/api", cfg(), "t", { onPage: () => {} })).rejects.toThrow(/didn't answer with JSON/);
    await expect(readRest("https://sis.example.ac.za/api", cfg(), null, { onPage: () => {} })).rejects.toThrow(/No key or token is saved/);
  });

  it("won't carry the token to another site on a redirect", async () => {
    serve(() => ({ status: 302, json: {}, headers: { location: "https://evil.example.com/steal" } }));
    const { readRest } = await sources();
    await expect(readRest("https://sis.example.ac.za/api", cfg(), "t", { onPage: () => {} })).rejects.toThrow(/different site/);
    expect(calls).toHaveLength(1);
  });
});

describe("Moodle errors", () => {
  it("turns Moodle's error codes into instructions", async () => {
    const { moodleTest } = await sources();
    serve(() => ({ json: { exception: "moodle_exception", errorcode: "invalidtoken", message: "Invalid token" } }));
    await expect(moodleTest("https://moodle.example.ac.za", "t")).rejects.toThrow(/didn't accept the token/);
    serve(() => ({ json: { exception: "webservice_access_exception", errorcode: "accessexception" } }));
    await expect(moodleTest("https://moodle.example.ac.za", "t")).rejects.toThrow(/isn't allowed/);
    serve(() => ({ text: "<!doctype html>", headers: { "content-type": "text/html" } }));
    await expect(moodleTest("https://moodle.example.ac.za/", "t")).rejects.toThrow(/didn't answer like Moodle/);
    // The token goes in the POST body, not the address.
    expect(calls[0].url).toBe("https://moodle.example.ac.za/webservice/rest/server.php");
    expect(new URLSearchParams(calls[0].body).get("wstoken")).toBe("t");
  });

  it("names the functions the Moodle service is missing", async () => {
    serve(() => ({ json: { sitename: "Campus Moodle", functions: [{ name: "core_webservice_get_site_info" }] } }));
    const { moodleTest } = await sources();
    const r = await moodleTest("https://moodle.example.ac.za", "t");
    expect(r.site).toBe("Campus Moodle");
    expect(r.missing).toEqual(["core_course_get_courses", "core_enrol_get_enrolled_users"]);
  });
});
