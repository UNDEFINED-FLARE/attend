import { beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "./harness";

// Readiness fixes (migration 0027, docs/capacity/10k-readiness-report.md): the indexes the
// report lists as missing exist. (S-1 is covered by 0021 membership_consent and its tests.)

let db: Db;

beforeAll(async () => {
  db = await createDb();
}, 120_000);

describe("indexes from the readiness report", () => {
  it("exist", async () => {
    const want = ["attendance_disputes_student", "class_sessions_lecturer", "class_sessions_venue", "verification_events_session"];
    const rows = await db.admin<{ indexname: string }>(
      "select indexname from pg_indexes where schemaname = 'uniattend' and indexname = any($1) order by 1", [want]);
    expect(rows.map((r) => r.indexname)).toEqual(want);
  });
});
