import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Vitest compiles JSX with the classic runtime, which expects a global React.
(globalThis as unknown as { React: typeof React }).React = React;
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const row = (role: string, institution_id: string | null) => ({
  role, institution_id, institution_name: institution_id ? "Test University" : null,
  institution_slug: null, institution_status: "active", brand_primary: null,
});

describe("role switcher", async () => {
  const { shellData } = await import("@/lib/shell-data");
  const { RoleSwitch } = await import("@/components/role-switch");
  const supabase = {
    from: () => ({ select: () => ({ is: async () => ({ count: 0 }), eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
  };

  it("shellData lists each role once, in switcher order, whatever institution it's held at", async () => {
    const out = await shellData({
      user: { email: "a@example.com", user_metadata: {} } as never,
      supabase: supabase as never,
      roles: [row("student", "i1"), row("lecturer", "i2"), row("lecturer", "i1"),
              row("institution_admin", "i1"), row("super_admin", null)] as never,
    });
    expect(out.roles).toEqual(["super_admin", "institution_admin", "lecturer", "student"]);
  });

  it("links to each role's area and marks the current one", () => {
    const html = renderToStaticMarkup(createElement(RoleSwitch, { roles: ["institution_admin", "lecturer"], active: "lecturer" }));
    expect(html).toContain('href="/admin"');
    expect(html).toMatch(/<a aria-current="page"[^>]*href="\/lecturer"/);
    expect(html.match(/<a /g)).toHaveLength(2);
  });

  it("renders nothing for a single role", () => {
    expect(renderToStaticMarkup(createElement(RoleSwitch, { roles: ["student"], active: "student" }))).toBe("");
  });
});
