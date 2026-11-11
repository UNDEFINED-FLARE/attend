import { describe, expect, it } from "vitest";
import { alertReason, friendlyAlertError, percentText } from "@/lib/early-warning";

describe("early warning wording", () => {
  it("drops a trailing .0 but keeps real decimals", () => {
    expect(percentText("0.0")).toBe("0%");
    expect(percentText(62.5)).toBe("62.5%");
    expect(percentText("75")).toBe("75%");
    expect(percentText(null)).toBe("—");
  });

  it("explains each kind of alert in one line", () => {
    expect(alertReason({ kind: "low_attendance", percent: "40.0", missed_in_a_row: null, required_pct: 75 })).toBe("Attendance 40% · needs 75%");
    expect(alertReason({ kind: "missed_in_a_row", percent: "66.7", missed_in_a_row: 4, required_pct: 75 })).toBe("Missed 4 classes in a row · attendance 66.7%");
    expect(alertReason({ kind: "missed_in_a_row", percent: null, missed_in_a_row: 1, required_pct: null })).toBe("Missed 1 class in a row");
  });

  it("turns database errors into plain sentences", () => {
    expect(friendlyAlertError("say why you are dismissing it")).toBe("Write a reason before dismissing it.");
    expect(friendlyAlertError("not your alert")).toBe("You can only follow up alerts for your own modules.");
    expect(friendlyAlertError("something unexpected")).toBe("something unexpected");
  });
});
