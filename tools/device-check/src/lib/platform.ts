import { Capacitor } from "@capacitor/core";

export const isNative = Capacitor.isNativePlatform();
export const platformLabel = isNative ? "Android app" : "Web browser";

/** Result of one check, shown as a coloured pill. */
export type Level = "idle" | "ok" | "warn" | "fail";
export type CheckKey = "notif" | "wifi" | "bt" | "gps";
export type Report = (key: CheckKey, level: Level) => void;

/** A GPS fix shared by the GPS card and the map. */
export interface Fix {
  lat: number;
  lng: number;
  accuracy: number;
  at: number;
}

export function errorText(e: unknown): string {
  if (e && typeof e === "object" && "message" in e && typeof e.message === "string") return e.message;
  return String(e);
}
