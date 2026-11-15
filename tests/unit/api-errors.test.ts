import { describe, expect, it } from "vitest";
import { apiError, bearerKey, fromDbError, STATUS } from "@/lib/api-errors";

describe("the public API's error contract", () => {
  it("maps database errors to stable codes and statuses", () => {
    expect(fromDbError({ code: "42501", message: "That API key is not valid." }).code).toBe("invalid_key");
    expect(fromDbError({ code: "UA409", message: "This Idempotency-Key was already used with a different body." }).code).toBe("idempotency_conflict");
    expect(fromDbError({ code: "P0002", message: "No such run for this key." }).code).toBe("not_found");
    expect(fromDbError({ code: "P0001", message: "Too many requests. Send at most 120 rosters an hour." }).code).toBe("rate_limited");
    expect(fromDbError({ code: "P0001", message: "This connection is paused." }).code).toBe("connection_paused");
    expect(fromDbError({ code: "P0001", message: "The institution is not active." }).code).toBe("institution_inactive");
    expect(fromDbError({ code: "22023", message: "Bad" }).code).toBe("invalid_request");
    expect(fromDbError({ code: "PGRST202", message: "x" }).code).toBe("unavailable");
  });

  it("never passes an unexpected database message to the caller", () => {
    const e = fromDbError({ code: "42P01", message: 'relation "uniattend.secret_table" does not exist' });
    expect(e.code).toBe("internal");
    expect(e.message).not.toContain("secret_table");
  });

  it("answers in one shape with a request id", async () => {
    const r = apiError("rate_limited", "Slow down.", "rid-1");
    expect(r.status).toBe(STATUS.rate_limited);
    expect(r.headers.get("X-Request-Id")).toBe("rid-1");
    expect(await r.json()).toEqual({ error: { code: "rate_limited", message: "Slow down." }, request_id: "rid-1" });
  });

  it("accepts only well-formed bearer keys", () => {
    const k = `ua_${"a".repeat(48)}`;
    expect(bearerKey(`Bearer ${k}`)).toBe(k);
    expect(bearerKey(`bearer   ${k}`)).toBe(k);
    expect(bearerKey("Bearer ua_short")).toBeNull();
    expect(bearerKey(null)).toBeNull();
    expect(bearerKey(`Basic ${k}`)).toBeNull();
  });
});
