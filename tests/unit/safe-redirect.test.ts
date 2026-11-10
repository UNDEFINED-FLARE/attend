import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/safe-redirect";

// 2. Open redirect: "next" must always stay on this site.
describe("safeNextPath", () => {
  it("keeps normal in-app paths, including query and hash", () => {
    expect(safeNextPath("/student")).toBe("/student");
    expect(safeNextPath("/lecturer/sessions/abc?tab=live#top")).toBe("/lecturer/sessions/abc?tab=live#top");
  });

  it.each([
    ["//evil.com"],
    ["/\\evil.com"],          // browsers read \ as /
    ["/\\/evil.com"],
    ["/\t/evil.com"],         // tab is stripped by URL parsers
    ["/\n/evil.com"],
    ["https://evil.com"],
    ["evil.com"],
    [""],
    [null],
    [undefined],
    [42],
  ])("rejects %j", (bad) => {
    expect(safeNextPath(bad)).toBe("/dashboard");
  });

  it("uses the given fallback", () => {
    expect(safeNextPath("//x", "/login")).toBe("/login");
  });
});
