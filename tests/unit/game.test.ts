import { describe, expect, it } from "vitest";
import { attendanceStreak, cardTier, slotState, type GameRec } from "@/lib/game";
import { parseLook } from "@/lib/look";

const rec = (status: string, created_at: string, code = "CSC111", opens_at = created_at): GameRec =>
  ({ status, created_at, modules: { code }, class_sessions: { opens_at } });

describe("parseLook", () => {
  it("is the institution's design unless the device chose the game look", () => {
    expect(parseLook("game")).toBe("game");
    expect(parseLook("simple")).toBe("simple");
    expect(parseLook(undefined)).toBe("simple");
    expect(parseLook("GAME")).toBe("simple");
  });
});

describe("attendanceStreak", () => {
  it("counts classes attended in a row, newest first, up to the first absence", () => {
    const recs = [
      rec("present", "2026-11-18T06:00:00Z"),
      rec("late", "2026-11-17T06:00:00Z"),
      rec("excused", "2026-11-16T06:00:00Z"),
      rec("pending_verification", "2026-11-15T06:00:00Z"),
      rec("late_pending", "2026-11-14T06:00:00Z"),
      rec("absent", "2026-11-13T06:00:00Z"),
      rec("present", "2026-11-12T06:00:00Z"),
    ];
    expect(attendanceStreak(recs)).toBe(3);
  });

  it("sorts by time itself and is zero after an absence or with no records", () => {
    expect(attendanceStreak([rec("present", "2026-11-10T06:00:00Z"), rec("absent", "2026-11-18T06:00:00Z")])).toBe(0);
    expect(attendanceStreak([rec("absent", "2026-11-10T06:00:00Z"), rec("present", "2026-11-18T06:00:00Z")])).toBe(1);
    expect(attendanceStreak([])).toBe(0);
  });
});

describe("slotState", () => {
  const slot = { code: "CSC111", start: "08:00", end: "09:00" };
  const today = "2026-11-18";

  it("shows the result of today's class for that module", () => {
    // 06:05 UTC is 08:05 in South Africa.
    expect(slotState(slot, "10:00", today, [rec("present", "2026-11-18T06:06:00Z", "CSC111", "2026-11-18T06:05:00Z")], false)).toBe("present");
    expect(slotState(slot, "10:00", today, [rec("late_pending", "2026-11-18T06:20:00Z")], false)).toBe("late");
    expect(slotState(slot, "10:00", today, [rec("absent", "2026-11-18T06:00:00Z")], false)).toBe("absent");
    expect(slotState(slot, "10:00", today, [rec("pending_verification", "2026-11-18T06:00:00Z")], false)).toBe("review");
    expect(slotState(slot, "10:00", today, [rec("excused", "2026-11-18T06:00:00Z")], false)).toBe("excused");
    // Opened up to 30 minutes early still belongs to the slot.
    expect(slotState(slot, "10:00", today, [rec("present", "2026-11-18T05:35:00Z")], false)).toBe("present");
  });

  it("ignores records of another module, another day, or another time", () => {
    expect(slotState(slot, "10:00", today, [rec("present", "2026-11-18T06:05:00Z", "MAT101")], false)).toBe("ended");
    expect(slotState(slot, "10:00", today, [rec("present", "2026-11-17T06:05:00Z")], false)).toBe("ended");
    // 05:20 UTC is 07:20, forty minutes before the slot; 07:05 UTC is 09:05, after it.
    expect(slotState(slot, "10:00", today, [rec("present", "2026-11-18T05:20:00Z")], false)).toBe("ended");
    expect(slotState(slot, "10:00", today, [rec("present", "2026-11-18T07:05:00Z")], false)).toBe("ended");
  });

  it("follows the clock when there is no record", () => {
    expect(slotState(slot, "08:30", today, [], false)).toBe("now");
    expect(slotState(slot, "09:00", today, [], false)).toBe("ended");
    expect(slotState(slot, "07:00", today, [], true)).toBe("next");
    expect(slotState(slot, "07:00", today, [], false)).toBe("later");
  });
});

describe("cardTier", () => {
  it("frames a module card by how it is going against its own requirement", () => {
    expect(cardTier(null, 75)).toBe("none");
    expect(cardTier(70, 75)).toBe("risk");
    expect(cardTier(80, 75)).toBe("ok");
    expect(cardTier(90, 75)).toBe("top");
    expect(cardTier(92, 95)).toBe("risk");
  });
});
