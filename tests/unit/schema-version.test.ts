import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXPECTED_SCHEMA } from "@/lib/schema-version";

describe("the schema version the app expects", () => {
  it("is the newest migration, and that migration records itself in schema_versions", () => {
    const dir = join(__dirname, "../../supabase/migrations");
    const newest = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().at(-1)!;
    expect(newest.slice(0, 14)).toBe(EXPECTED_SCHEMA);
    expect(readFileSync(join(dir, newest), "utf8")).toContain(`'${EXPECTED_SCHEMA}'`);
  });
});
