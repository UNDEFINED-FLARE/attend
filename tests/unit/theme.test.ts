import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, inkOn, parseTheme, ThemeSchema, themeStyle } from "@/lib/theme";

describe("institution theme", () => {
  it("falls back to defaults for missing or broken values", () => {
    expect(parseTheme(null)).toEqual(DEFAULT_THEME);
    expect(parseTheme({ colors: { primary: "red" } }).colors.primary).toBe(DEFAULT_THEME.colors.primary);
    // The default is "sharp": the campus-signage plates (globals.css).
    expect(parseTheme({ shape: "blobby" }).shape).toBe(DEFAULT_THEME.shape);
    expect(DEFAULT_THEME.shape).toBe("sharp");
  });
  it("keeps valid parts of a partial theme", () => {
    const t = parseTheme({ colors: { primary: "#006400" }, header: { style: "gradient" }, footer: { show: true, text: "© UNIVEN" } });
    expect(t.colors.primary).toBe("#006400");
    expect(t.colors.accent).toBe(DEFAULT_THEME.colors.accent);
    expect(t.header.style).toBe("gradient");
    expect(t.footer).toMatchObject({ show: true, text: "© UNIVEN", links: [] });
  });
  it("rejects unsafe links and logos", () => {
    expect(ThemeSchema.shape.header.safeParse({ ...DEFAULT_THEME.header, logoUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(ThemeSchema.shape.footer.safeParse({ show: true, text: "", links: [{ label: "x", url: "javascript:alert(1)" }] }).success).toBe(false);
    expect(ThemeSchema.shape.footer.safeParse({ show: true, text: "", links: [{ label: "Help", url: "https://univen.ac.za" }] }).success).toBe(true);
  });
  it("requires every student card exactly once", () => {
    const cards = [...DEFAULT_THEME.student.cards]; cards[1] = cards[0];
    expect(ThemeSchema.shape.student.safeParse({ ...DEFAULT_THEME.student, cards }).success).toBe(false);
  });
  it("picks readable text and maps to CSS variables", () => {
    expect(inkOn("#ffffff")).toBe("#0f1b2d");
    expect(inkOn("#0b2545")).toBe("#ffffff");
    expect(themeStyle({ ...DEFAULT_THEME, shape: "sharp" })["--radius-2xl"]).toBe("8px");
    expect(themeStyle({ ...DEFAULT_THEME, shape: "rounded" })["--radius-2xl"]).toBe("16px");
  });
});
