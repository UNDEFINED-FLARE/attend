import { describe, expect, it } from "vitest";
import { buildCsp, cspHeaderName, cspMode, newNonce } from "@/lib/csp";

const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

describe("cspMode", () => {
  it("enforces in production and is off in development unless CSP_MODE says otherwise", () => {
    expect(cspMode(undefined, true)).toBe("enforce");
    expect(cspMode(undefined, false)).toBe("off");
    expect(cspMode("report-only", true)).toBe("report-only");
    expect(cspMode("off", true)).toBe("off");
    expect(cspMode("enforce", false)).toBe("enforce");
    expect(cspMode("nonsense", true)).toBe("enforce");
  });

  it("uses the report-only header only in report-only mode", () => {
    expect(cspHeaderName("enforce")).toBe("Content-Security-Policy");
    expect(cspHeaderName("report-only")).toBe("Content-Security-Policy-Report-Only");
  });
});

describe("newNonce", () => {
  it("is 128 random bits in base64, different every time", () => {
    const a = newNonce(), b = newNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(a).not.toBe(b);
  });
});

describe("buildCsp", () => {
  const prod = buildCsp({ nonce: "abc123", supabaseUrl: "https://xyz.supabase.co" });

  it("only runs scripts with this request's nonce (or loaded by them)", () => {
    const s = directive(prod, "script-src");
    expect(s).toContain("'nonce-abc123'");
    expect(s).toContain("'strict-dynamic'");
    expect(s).not.toContain("'unsafe-inline'");
    expect(s).not.toContain("'unsafe-eval'");
  });

  it("can't be framed, has no plugins, keeps the base on this site and sends forms only over https", () => {
    expect(directive(prod, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(prod, "object-src")).toBe("object-src 'none'");
    expect(directive(prod, "base-uri")).toBe("base-uri 'self'");
    // https: so sign-in by institution can redirect to the institution's identity provider.
    expect(directive(prod, "form-action")).toBe("form-action 'self' https:");
    expect(prod.endsWith("upgrade-insecure-requests")).toBe(true);
  });

  it("connects only to this site, the Supabase project (API and realtime) and the named map and bot-check services", () => {
    const c = directive(prod, "connect-src").split(" ").slice(1);
    expect(c).toEqual(["'self'", "https://xyz.supabase.co", "wss://xyz.supabase.co", "https://overpass-api.de",
      "https://nominatim.openstreetmap.org", "https://challenges.cloudflare.com"]);
  });

  it("allows the service worker", () => {
    expect(directive(prod, "worker-src")).toContain("'self'");
  });

  it("adds what the dev server needs only in development", () => {
    const dev = buildCsp({ nonce: "n", supabaseUrl: "http://127.0.0.1:54321", dev: true });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(directive(dev, "connect-src")).toContain("ws://127.0.0.1:54321");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });

  it("upgrades insecure requests only for pages served over https", () => {
    expect(buildCsp({ nonce: "n", upgrade: true })).toContain("upgrade-insecure-requests");
    expect(buildCsp({ nonce: "n", upgrade: false })).not.toContain("upgrade-insecure-requests");
  });

  it("still builds a policy when the Supabase address is missing or malformed", () => {
    expect(directive(buildCsp({ nonce: "n" }), "connect-src")).toContain("'self'");
    expect(directive(buildCsp({ nonce: "n", supabaseUrl: "not a url" }), "connect-src")).not.toContain("not");
  });
});
