import { describe, expect, it } from "vitest";
import { isStale, METHODS, PROVIDER_KEYS, PROVIDERS, providerDef, providerOf, runCounts } from "@/lib/integrations/providers";
import { parseOptions } from "@/lib/integrations/roster";

describe("provider catalogue", () => {
  it("lists every provider once, and only methods that exist", () => {
    expect(PROVIDERS.map((p) => p.key)).toEqual([...PROVIDER_KEYS]);
    for (const p of PROVIDERS) for (const m of p.methods) expect(METHODS[m]).toBeDefined();
  });

  it("never offers a direct vendor connection that isn't built", () => {
    // Vendors without a built connector get files, a link or the push API, plus a plain "not yet".
    for (const k of ["its", "banner", "peoplesoft", "blackboard", "celcat"]) {
      const p = providerDef(k)!;
      expect(p.methods).not.toContain("moodle");
      expect(p.notYet).toBeTruthy();
    }
    expect(providerDef("entra")!.methods).toEqual([]);
  });

  it("remembers which provider a connection is for, and falls back sensibly", () => {
    expect(providerOf("feed", { provider: "its" })?.name).toBe("ITS Integrator");
    expect(providerOf("moodle", {})?.key).toBe("moodle");
    expect(providerOf("api", { provider: "nonsense" })?.key).toBe("custom");
    expect(parseOptions({ provider: "banner" }).provider).toBe("banner");
    expect(parseOptions({ provider: "evil<script>" }).provider).toBeUndefined();
  });
});

describe("run counts and health", () => {
  it("reads both kinds of run summary the same way", () => {
    expect(runCounts({ received: 10, inserted: 4, updated: 3, unchanged: 2, rejected: 1 })).toEqual({ received: 10, inserted: 4, updated: 3, rejected: 1 });
    expect(runCounts({ people: 7, students_added: 2, lecturers_added: 1, enrolments_added: 5, assignments_added: 1, modules_created: 0,
      students_updated: 1, lecturers_updated: 0, skipped: 2 })).toEqual({ received: 7, inserted: 9, updated: 1, rejected: 2 });
    expect(runCounts(null)).toEqual({ received: 0, inserted: 0, updated: 0, rejected: 0 });
  });

  it("flags a scheduled connection that hasn't succeeded for twice its interval", () => {
    const now = Date.parse("2026-11-14T12:00:00Z");
    expect(isStale("daily", "active", "2026-11-13T12:00:00Z", "2026-11-01T00:00:00Z", now)).toBe(false);
    expect(isStale("daily", "active", "2026-11-12T08:00:00Z", "2026-11-01T00:00:00Z", now)).toBe(true);
    expect(isStale("hourly", "active", "2026-11-14T09:30:00Z", "2026-11-01T00:00:00Z", now)).toBe(false);
    expect(isStale("hourly", "active", "2026-11-14T08:30:00Z", "2026-11-01T00:00:00Z", now)).toBe(true);
    expect(isStale("manual", "active", null, "2026-01-01T00:00:00Z", now)).toBe(false);
    expect(isStale("daily", "paused", null, "2026-01-01T00:00:00Z", now)).toBe(false);
    expect(isStale("daily", "active", null, "2026-11-14T10:00:00Z", now)).toBe(false);
  });
});
