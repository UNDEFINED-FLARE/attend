import { describe, expect, it } from "vitest";
import { menuFor } from "@/lib/nav-config";
import { DEFAULT_THEME, parseTheme } from "@/lib/theme";

const hrefs = (items: { href: string }[]) => items.map((i) => i.href);

describe("menus an institution designs", () => {
  it("starts from the app's defaults", () => {
    expect(hrefs(menuFor("lecturer", DEFAULT_THEME))).toEqual(["/lecturer", "/lecturer/timetable", "/lecturer/disputes", "/lecturer/early-warning", "/notifications"]);
  });

  it("applies renames, order and hidden items, but never hides locked ones", () => {
    const theme = parseTheme({ menus: { student: [
      { href: "/student/history", label: "My record", show: true },
      { href: "/student", label: "Start", show: false },          // locked: stays
      { href: "/student/map", label: "Map", show: false },        // hidden
    ], lecturer: [], admin: [] } });
    const m = menuFor("student", theme);
    expect(m.map((i) => [i.href, i.label])).toEqual([
      ["/student/history", "My record"], ["/student", "Start"], ["/student/timetable", "Timetable"], ["/student/check-in", "Check in"],
    ]);
  });

  it("removes items for switched-off features", () => {
    const theme = parseTheme({ features: { ...DEFAULT_THEME.features, earlyWarning: false } });
    expect(hrefs(menuFor("admin", theme))).not.toContain("/admin/early-warning");
    expect(hrefs(menuFor("lecturer", theme))).not.toContain("/lecturer/early-warning");
  });

  it("ignores unknown links and keeps the saved theme valid", () => {
    const theme = parseTheme({ menus: { student: [{ href: "/evil", label: "x", show: true }], lecturer: [], admin: [] } });
    expect(hrefs(menuFor("student", theme))).not.toContain("/evil");
    expect(parseTheme({ menus: { student: [{ href: "javascript:alert(1)", label: "x", show: true }] } }).menus).toEqual(DEFAULT_THEME.menus);
  });
});
