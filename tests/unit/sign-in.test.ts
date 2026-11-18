import { describe, expect, it } from "vitest";
import { parseDirectory, searchDirectory } from "@/lib/sign-in";

const raw = [
  { slug: "univen", name: "University of Venda", short_name: "UNIVEN", method: "sso", provider: "custom:univen", provider_name: "UNIVEN account", campuses: ["Thohoyandou"] },
  { slug: "ul", name: "University of Limpopo", short_name: "UL", method: "email", campuses: ["Turfloop", "Medunsa"] },
  { slug: "tut", name: "Tshwane University of Technology", short_name: "TUT", method: "none" },
];

describe("the sign-in directory", () => {
  it("keeps well-formed entries and their way in", () => {
    const d = parseDirectory(raw);
    expect(d.map((e) => [e.slug, e.method])).toEqual([["univen", "sso"], ["ul", "email"], ["tut", "none"]]);
    expect(d[0]).toMatchObject({ provider: "custom:univen", scopes: "openid profile email" });
    expect(d[1].provider).toBeUndefined();
  });

  it("never trusts a malformed entry or provider", () => {
    const d = parseDirectory([
      { slug: "Bad Slug", name: "x", method: "email" },
      { slug: "evil", name: "Evil", method: "sso", provider: "https://attacker.example" },
      { slug: "logo", name: "Logo", method: "email", logo: "http://insecure.example/logo.png" },
      null, 7,
    ]);
    expect(d.map((e) => e.slug)).toEqual(["evil", "logo"]);
    expect(d[0].method).toBe("none");
    expect(d[1].logo).toBeUndefined();
    expect(parseDirectory({ not: "a list" })).toEqual([]);
  });

  it("finds an institution by name, short name or campus, ignoring case and accents", () => {
    const d = parseDirectory(raw);
    expect(searchDirectory(d, "venda").map((e) => e.slug)).toEqual(["univen"]);
    expect(searchDirectory(d, "tut").map((e) => e.slug)).toEqual(["tut"]);
    expect(searchDirectory(d, "médunsa").map((e) => e.slug)).toEqual(["ul"]);
    expect(searchDirectory(d, "university of").length).toBe(3);
    expect(searchDirectory(d, "  ").length).toBe(3);
    expect(searchDirectory(d, "wits")).toEqual([]);
  });

  it("puts names that start with the search first", () => {
    const d = parseDirectory(raw);
    expect(searchDirectory(d, "u")[0].slug).toBe("univen");
    expect(searchDirectory(d, "tshwane")[0].slug).toBe("tut");
  });
});
