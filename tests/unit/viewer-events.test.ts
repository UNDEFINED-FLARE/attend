import { describe, expect, it } from "vitest";
import { eventToClass, groupLabel, type ViewerEvent } from "@/lib/viewer-events";

const ev = (over: Partial<ViewerEvent>): ViewerEvent => ({
  eventId: 1, moduleName: "ECS1245", dayOfWeek: 1, startTime: "15:00", endTime: "16:50",
  rooms: [{ name: "BUILDING : E-BLOCK @ ROOM : E4", capacity: 350 }], staff: ["A LECTURER"], groups: [{ name: "ECS1245_2", studentCount: 313 }], ...over,
});

describe("timetable viewer API events", () => {
  it("maps day 0 to Monday and keeps room capacity and group", () => {
    expect(eventToClass(ev({ dayOfWeek: 0 }))).toEqual({
      code: "ECS1245", weekday: 1, starts_at: "15:00", ends_at: "16:50", online: false, building: "E-BLOCK", room: "E4",
      venue: "E-Block E4", lecturer: "A LECTURER", group: "Group 2", capacity: 350, students: 313, sourceId: 1,
    });
  });
  it("treats Online rooms as online with no venue", () => {
    const c = eventToClass(ev({ rooms: [{ name: "Online", capacity: null }], staff: [] }))!;
    expect([c.online, c.venue, c.capacity, c.lecturer]).toEqual([true, null, null, null]);
  });
  it("rejects bad codes, days and times", () => {
    expect(eventToClass(ev({ moduleName: "not a code" }))).toBeNull();
    expect(eventToClass(ev({ dayOfWeek: 9 }))).toBeNull();
    expect(eventToClass(ev({ startTime: "17:00", endTime: "16:00" }))).toBeNull();
  });
  it("labels groups", () => {
    expect(groupLabel([{ name: "BIO1243_1", studentCount: 1 }, { name: "BIO1243_3", studentCount: 1 }])).toBe("Group 1, Group 3");
    expect(groupLabel([])).toBeNull();
  });
});
