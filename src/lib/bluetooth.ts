// Bluetooth evidence at check-in (database update 0037).
//
// The lecturer's phone broadcasts a Bluetooth Low Energy signal carrying an 8-byte
// value that the database signs with the session's secret and changes every 20
// seconds, like the live QR. The student's phone listens for a few seconds during
// check-in and sends what it heard (the value and the signal strength). The
// database decides what it is worth; nothing here can.
//
// Both sides need the UniAttend Android app: browsers cannot broadcast, and iPhone
// browsers cannot listen. Without the app, check-in works exactly as before.

/** The service the app broadcasts and listens for. Fixed for UniAttend, not secret. */
export const BLE_SERVICE_UUID = "474a16df-2681-41ef-a326-836b17d9cc8e";
/** How long the student's phone listens at check-in (runs alongside the GPS reading). */
export const BLE_SCAN_MS = 4000;
/** The most readings sent; the database reads no more than 30. */
export const BLE_MAX_OBSERVATIONS = 30;

export type BleObservation = { id: string; rssi: number };

const ID = /^[0-9a-f]{16}$/;

/** Is this a broadcast value as the database signs it: 16 lower-case hex characters. */
export const isBleId = (s: unknown): s is string => typeof s === "string" && ID.test(s);

/**
 * Cleans what the native scanner returned before it is sent: keeps well-formed
 * readings (a 16-hex value and a whole RSSI between -127 and 0 dBm), strongest
 * first, at most 30. Readings are not merged: several readings of the same value
 * with different strengths are what a real radio produces.
 */
export function normalizeObservations(raw: unknown): BleObservation[] {
  if (!Array.isArray(raw)) return [];
  const out: BleObservation[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const id = typeof (r as { id?: unknown }).id === "string" ? (r as { id: string }).id.toLowerCase() : null;
    const rssi = (r as { rssi?: unknown }).rssi;
    if (!isBleId(id) || typeof rssi !== "number" || !Number.isFinite(rssi) || rssi < -127 || rssi > 0) continue;
    out.push({ id, rssi: Math.round(rssi) });
  }
  return out.sort((a, b) => b.rssi - a.rssi).slice(0, BLE_MAX_OBSERVATIONS);
}

/** Plain words for a signal strength, for the lecturer's screen. */
export function describeRssi(rssi: number, minRssi = -90): "close" | "in the room" | "faint" {
  if (rssi >= minRssi + 15) return "close";
  if (rssi >= minRssi) return "in the room";
  return "faint";
}

// ------------------------------------------------------------- the native plugin

type ScanResult = { observations?: unknown };
type BlePlugin = {
  scan(o: { serviceUuid: string; durationMs: number }): Promise<ScanResult>;
  startAdvertising(o: { serviceUuid: string; id: string }): Promise<void>;
  stopAdvertising(): Promise<void>;
};
type Cap = {
  isNativePlatform?: () => boolean;
  isPluginAvailable?: (n: string) => boolean;
  Plugins?: Record<string, unknown>;
};
const cap = () => (typeof window === "undefined" ? undefined : (window as unknown as { Capacitor?: Cap }).Capacitor);

/** True in a UniAttend Android app new enough to have the Bluetooth plugin. */
export function bluetoothAvailable(): boolean {
  const c = cap();
  return !!c?.isNativePlatform?.() && !!c.isPluginAvailable?.("UniAttendBle");
}

let proxy: BlePlugin | null = null;
async function plugin(): Promise<BlePlugin | null> {
  if (!bluetoothAvailable()) return null;
  const legacy = cap()!.Plugins?.UniAttendBle as BlePlugin | undefined;
  if (legacy) return legacy;
  if (!proxy) proxy = (await import("@capacitor/core")).registerPlugin<BlePlugin>("UniAttendBle");
  return proxy;
}

/**
 * Listens for the class signal. Resolves with the readings, an empty list if
 * nothing was heard, or null when Bluetooth is unavailable, off or refused — a
 * refusal is reported, not punished.
 */
export async function scanForClass(ms = BLE_SCAN_MS): Promise<BleObservation[] | null> {
  const p = await plugin();
  if (!p) return null;
  try {
    const r = await p.scan({ serviceUuid: BLE_SERVICE_UUID, durationMs: ms });
    return normalizeObservations(r?.observations);
  } catch {
    return null;
  }
}

export async function startBroadcast(id: string): Promise<void> {
  const p = await plugin();
  if (!p) throw new Error("Bluetooth broadcasting needs the UniAttend Android app.");
  if (!isBleId(id)) throw new Error("The class signal could not be read.");
  await p.startAdvertising({ serviceUuid: BLE_SERVICE_UUID, id });
}

export async function stopBroadcast(): Promise<void> {
  try { await (await plugin())?.stopAdvertising(); } catch { /* already stopped */ }
}
