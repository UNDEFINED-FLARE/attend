import { afterEach, describe, expect, it } from "vitest";
import { BLE_MAX_OBSERVATIONS, bluetoothAvailable, describeRssi, isBleId, normalizeObservations, scanForClass } from "@/lib/bluetooth";

describe("isBleId", () => {
  it("accepts exactly 16 lower-case hex characters", () => {
    expect(isBleId("0123456789abcdef")).toBe(true);
    expect(isBleId("0123456789ABCDEF")).toBe(false);
    expect(isBleId("0123456789abcde")).toBe(false);
    expect(isBleId("0123456789abcdef0")).toBe(false);
    expect(isBleId(1234)).toBe(false);
  });
});

describe("normalizeObservations", () => {
  it("keeps well-formed readings, strongest first, and lower-cases values from the scanner", () => {
    expect(normalizeObservations([
      { id: "AAAAAAAAAAAAAAAA", rssi: -80.4 },
      { id: "bbbbbbbbbbbbbbbb", rssi: -61 },
    ])).toEqual([{ id: "bbbbbbbbbbbbbbbb", rssi: -61 }, { id: "aaaaaaaaaaaaaaaa", rssi: -80 }]);
  });

  it("drops anything malformed instead of failing", () => {
    expect(normalizeObservations([
      null, "x", { id: "short", rssi: -50 }, { id: "cccccccccccccccc", rssi: 5 }, { id: "cccccccccccccccc", rssi: -200 },
      { id: "cccccccccccccccc", rssi: Number.NaN }, { id: "cccccccccccccccc", rssi: "-50" }, { rssi: -50 },
    ])).toEqual([]);
    expect(normalizeObservations(undefined)).toEqual([]);
    expect(normalizeObservations({ id: "cccccccccccccccc", rssi: -50 })).toEqual([]);
  });

  it("keeps repeated readings of one value (the database looks at how they vary)", () => {
    const r = normalizeObservations([{ id: "dddddddddddddddd", rssi: -70 }, { id: "dddddddddddddddd", rssi: -72 }]);
    expect(r).toHaveLength(2);
  });

  it("sends at most 30", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ id: "eeeeeeeeeeeeeeee", rssi: -40 - i }));
    const r = normalizeObservations(many);
    expect(r).toHaveLength(BLE_MAX_OBSERVATIONS);
    expect(r[0].rssi).toBe(-40);
  });
});

describe("describeRssi", () => {
  it("matches the database's bands for the default -90 dBm", () => {
    expect(describeRssi(-60)).toBe("close");
    expect(describeRssi(-75)).toBe("close");
    expect(describeRssi(-76)).toBe("in the room");
    expect(describeRssi(-90)).toBe("in the room");
    expect(describeRssi(-91)).toBe("faint");
    expect(describeRssi(-80, -100)).toBe("close");
    expect(describeRssi(-95, -100)).toBe("in the room");
  });
});

describe("outside the Android app", () => {
  const g = globalThis as { window?: unknown };
  afterEach(() => { delete g.window; });

  it("is unavailable on the server and in a plain browser, and scanning resolves null", async () => {
    expect(bluetoothAvailable()).toBe(false);
    g.window = { Capacitor: { isNativePlatform: () => false, isPluginAvailable: () => true } };
    expect(bluetoothAvailable()).toBe(false);
    expect(await scanForClass(10)).toBeNull();
  });

  it("uses the plugin in the app and cleans its results", async () => {
    const UniAttendBle = { scan: async () => ({ observations: [{ id: "FFFFFFFFFFFFFFFF", rssi: -70 }, { id: "bad", rssi: -1 }] }) };
    g.window = { Capacitor: { isNativePlatform: () => true, isPluginAvailable: (n: string) => n === "UniAttendBle", Plugins: { UniAttendBle } } };
    expect(bluetoothAvailable()).toBe(true);
    expect(await scanForClass(10)).toEqual([{ id: "ffffffffffffffff", rssi: -70 }]);
  });

  it("treats a refused permission as no Bluetooth, not an error", async () => {
    const UniAttendBle = { scan: async () => { throw new Error("denied"); } };
    g.window = { Capacitor: { isNativePlatform: () => true, isPluginAvailable: () => true, Plugins: { UniAttendBle } } };
    expect(await scanForClass(10)).toBeNull();
  });
});
