import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LayoutModeProvider, LayoutToggle, Parts } from "@/components/layout-mode";
import { parseLayoutMode, partFromHash } from "@/lib/layout-mode";

// The component file uses JSX compiled for a global React (as the app's other client components).
(globalThis as { React?: typeof React }).React = React;
const h = React.createElement;

const parts = [
  { id: "now", label: "Now", content: h("p", null, "NOW-CONTENT") },
  { id: "today", label: "Today", content: h("p", null, "TODAY-CONTENT") },
  { id: "modules", label: "Modules", content: h("p", null, "MODULES-CONTENT") },
];
const render = (mode: "scroll" | "buttons", props: Partial<React.ComponentProps<typeof Parts>> = {}) =>
  renderToStaticMarkup(h(LayoutModeProvider, {
    initial: mode,
    children: [h(LayoutToggle, { key: "switch" }), h(Parts, { key: "parts", label: "Home", parts, ...props })],
  }));

describe("choosing Scroll or Buttons", () => {
  it("reads the saved choice, and anything else means the usual scrolling page", () => {
    expect(parseLayoutMode("buttons")).toBe("buttons");
    expect(parseLayoutMode("scroll")).toBe("scroll");
    expect(parseLayoutMode(undefined)).toBe("scroll");
    expect(parseLayoutMode("<script>")).toBe("scroll");
  });

  it("finds the part a link asks for, with or without the part- prefix", () => {
    const ids = parts.map((p) => p.id);
    expect(partFromHash("#part-modules", ids)).toBe("modules");
    expect(partFromHash("#today", ids)).toBe("today");
    expect(partFromHash("#settings", ids)).toBeNull();
    expect(partFromHash("", ids)).toBeNull();
  });
});

describe("a page made of parts", () => {
  it("Scroll shows every part, one under the other, and no tabs", () => {
    const html = render("scroll");
    expect(html).toContain("NOW-CONTENT");
    expect(html).toContain("TODAY-CONTENT");
    expect(html).toContain("MODULES-CONTENT");
    expect(html).not.toContain('role="tablist"');
  });

  it("Scroll keeps the page's own arrangement when it gives one", () => {
    const html = render("scroll", { scrollView: h("div", null, "OWN-LAYOUT") });
    expect(html).toContain("OWN-LAYOUT");
    expect(html).not.toContain("NOW-CONTENT");
  });

  it("Scroll with jump links: a button per part that jumps to it", () => {
    const html = render("scroll", { jumpLinks: true });
    expect(html).toContain('href="#part-today"');
    expect(html).toContain('id="part-today"');
  });

  it("Buttons shows a row of tabs and only the chosen part, with Next to the following one", () => {
    const html = render("buttons");
    expect(html).toContain('role="tablist"');
    expect((html.match(/role="tab"/g) ?? []).length).toBe(3);
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("NOW-CONTENT");
    expect(html).not.toContain("TODAY-CONTENT");
    expect(html).toContain('role="tabpanel"');
    expect(html).toMatch(/Next: <\/span>Today/);
    expect(html).not.toMatch(/Previous: /);
  });

  it("the switch shows which choice is on", () => {
    expect(render("buttons")).toMatch(/role="radio" aria-checked="true"[^>]*>Buttons</);
    expect(render("scroll")).toMatch(/role="radio" aria-checked="true"[^>]*>Scroll</);
  });
});
