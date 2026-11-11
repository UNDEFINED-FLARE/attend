import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout, SUPABASE_TIMEOUT_MS } from "@/lib/supabase/fetch";
import { getAuthUser, userFromClaims } from "@/lib/supabase/resilient";

// Readiness fixes: who is signed in comes from verified token claims (no Auth round trip),
// network trouble is "unreachable" (never "signed out"), and Supabase requests can't hang.

/** A fake Supabase client whose getClaims() returns (or throws) these in turn. It has no getUser. */
function client(...results: unknown[]) {
  const getClaims = vi.fn();
  for (const r of results) {
    if (r instanceof Error) getClaims.mockRejectedValueOnce(r);
    else getClaims.mockResolvedValueOnce(r);
  }
  return { supabase: { auth: { getClaims } } as never, getClaims };
}
const ok = (claims: object) => ({ data: { claims }, error: null });
const network = { data: null, error: { name: "AuthRetryableFetchError", message: "fetch failed" } };

describe("userFromClaims", () => {
  it("keeps the fields the app uses", () => {
    expect(userFromClaims({ sub: "u1", email: "a@b.test", user_metadata: { full_name: "A" } }))
      .toEqual({ id: "u1", email: "a@b.test", user_metadata: { full_name: "A" }, app_metadata: {} });
  });
  it("no subject means nobody is signed in", () => {
    expect(userFromClaims({ email: "a@b.test" })).toBeNull();
    expect(userFromClaims(null)).toBeNull();
  });
});

describe("getAuthUser", () => {
  it("returns the signed-in user from the verified claims", async () => {
    const { supabase } = client(ok({ sub: "u1", email: "a@b.test", user_metadata: {} }));
    expect(await getAuthUser(supabase)).toEqual({ user: { id: "u1", email: "a@b.test", user_metadata: {}, app_metadata: {} }, unreachable: false });
  });

  it("signed out, or a bad token: no user, but reachable", async () => {
    expect(await getAuthUser(client({ data: null, error: null }).supabase)).toEqual({ user: null, unreachable: false });
    expect(await getAuthUser(client({ data: null, error: { name: "AuthInvalidJwtError", message: "bad" } }).supabase))
      .toEqual({ user: null, unreachable: false });
  });

  it("retries once after a network error", async () => {
    const { supabase, getClaims } = client(network, ok({ sub: "u1" }));
    expect((await getAuthUser(supabase)).user?.id).toBe("u1");
    expect(getClaims).toHaveBeenCalledTimes(2);
  });

  it("two network failures (or a timed-out fetch) mean unreachable, never signed out", async () => {
    expect(await getAuthUser(client(network, network).supabase)).toEqual({ user: null, unreachable: true });
    expect(await getAuthUser(client(new Error("timeout"), new Error("timeout")).supabase)).toEqual({ user: null, unreachable: true });
  });
});

describe("fetchWithTimeout", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** A fetch that never answers, but rejects when its signal aborts. */
  const hanging = () => vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) =>
    new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason))));

  it("gives up on a request that never answers", async () => {
    vi.useFakeTimers();
    hanging();
    const pending = expect(fetchWithTimeout("https://example.test")).rejects.toThrow(/did not answer within 15 s/);
    await vi.advanceTimersByTimeAsync(SUPABASE_TIMEOUT_MS);
    await pending;
  });

  it("still honours the caller's own abort", async () => {
    hanging();
    const ctl = new AbortController();
    const pending = expect(fetchWithTimeout("https://example.test", { signal: ctl.signal })).rejects.toThrow(/stop/);
    ctl.abort(new Error("stop"));
    await pending;
  });

  it("returns the response when it answers in time", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    expect(await (await fetchWithTimeout("https://example.test")).text()).toBe("ok");
  });
});
