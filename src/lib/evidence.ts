"use client";
// Client-side evidence collection. Everything here is *input* to the server's
// verdict; none of it decides anything.

export type GpsSample = { lat: number; lng: number; accuracy: number };

/**
 * Several fresh readings over a few seconds (ported from univen.html's
 * collectGpsSamples). Resolves with whatever it has when time runs out, or null
 * if location is unavailable or refused — a refusal is reported, not punished.
 */
export function collectGps(maxMs = 6000, want = 4): Promise<GpsSample[] | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    const samples: GpsSample[] = [];
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      navigator.geolocation.clearWatch(watch);
      clearTimeout(timer);
      resolve(samples.length ? samples : null);
    };
    const watch = navigator.geolocation.watchPosition(
      (p) => {
        samples.push({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
        if (samples.length >= want) finish();
      },
      () => finish(),
      { enableHighAccuracy: true, maximumAge: 0, timeout: maxMs },
    );
    const timer = setTimeout(finish, maxMs);
  });
}

/**
 * A random id that never leaves the device; only SHA-256 of it is sent.
 * Clearing site data produces a new one, which is fine: the server treats a
 * new device as normal, and only flags one device used by several students.
 */
export async function deviceHash(): Promise<string | null> {
  try {
    let id = localStorage.getItem("ua_device");
    if (!id) {
      const b = crypto.getRandomValues(new Uint8Array(32));
      id = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
      localStorage.setItem("ua_device", id);
    }
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`uniattend-device:${id}`));
    return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/** Accepts either a full check-in URL from the QR or a bare code. */
export function parseScan(text: string): { session: string | null; token: string | null; code: string | null } {
  try {
    const u = new URL(text);
    const s = u.searchParams.get("s");
    const t = u.searchParams.get("t");
    if (s && t) return { session: s, token: t, code: u.searchParams.get("c") };
  } catch { /* not a URL */ }
  const code = text.trim().toUpperCase();
  return { session: null, token: null, code: /^[A-Z0-9]{6}$/.test(code) ? code : null };
}
