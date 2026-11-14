import { describe, expect, it } from "vitest";
import { authCookieOptions } from "@/lib/supabase/cookies";

describe("remembered sign-in cookies", () => {
  it("keeps the session for 400 days by default", () => {
    expect(authCookieOptions({ path: "/", maxAge: 3600 }, false)).toEqual({ path: "/", maxAge: 400 * 24 * 60 * 60 });
  });
  it("makes it a browser-session cookie when 'Keep me signed in' is off", () => {
    expect(authCookieOptions({ path: "/", maxAge: 3600, expires: new Date() }, true)).toEqual({ path: "/" });
  });
  it("never turns a sign-out (delete) into a long-lived cookie", () => {
    expect(authCookieOptions({ path: "/", maxAge: 0 }, false)).toEqual({ path: "/", maxAge: 0 });
  });
});
