import { describe, expect, it } from "vitest";
import {
  clearSnapshots, CURRENT_KEY, isSnapshot, nowAndNext, purgeOthers, readSnapshot, safeReturn, saveSnapshot, SNAPSHOT_PREFIX,
  syncDue, tabFor, updatedAgo, type OfflineSnapshot,
} from "@/lib/offline-data";
import { nativeLabel } from "@/lib/app-lock";
import { formatBytes, parseRelease } from "@/lib/app-release";

/** A Storage in memory, like a phone's localStorage. */
function memory(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
}

const snap = (userId: string, extra: Partial<OfflineSnapshot> = {}): OfflineSnapshot => ({
  v: 1, userId, role: "student", name: "Thandi Mokoena", institution: { id: "i1", name: "Test University" },
  savedAt: "2026-11-18T08:00:00.000Z", timetable: [], classes: [], modules: [], venues: [], history: [], sessions: [], ...extra,
});

describe("offline copy on a shared phone", () => {
  it("keeps only the person who synced last", () => {
    const s = memory();
    expect(saveSnapshot(snap("alice"), s)).toBe(true);
    expect(readSnapshot(s)?.userId).toBe("alice");
    // Bob signs in on the same phone and syncs: Alice's copy is gone, not just hidden.
    expect(saveSnapshot(snap("bob"), s)).toBe(true);
    expect(readSnapshot(s)?.userId).toBe("bob");
    expect(s.getItem(SNAPSHOT_PREFIX + "alice")).toBeNull();
  });

  it("drops other people's copies when someone else opens the app", () => {
    const s = memory();
    saveSnapshot(snap("alice"), s);
    purgeOthers("bob", s);
    expect(readSnapshot(s)).toBeNull();
    expect(s.getItem(SNAPSHOT_PREFIX + "alice")).toBeNull();
    expect(s.getItem(CURRENT_KEY)).toBeNull();
  });

  it("sign-out wipes everything", () => {
    const s = memory();
    saveSnapshot(snap("alice"), s);
    s.setItem("ua_lock", "kept");             // other settings are not touched
    clearSnapshots(s);
    expect(readSnapshot(s)).toBeNull();
    expect(s.length).toBe(1);
  });

  it("never shows a copy stored under a different person", () => {
    const s = memory();
    s.setItem(CURRENT_KEY, "bob");
    s.setItem(SNAPSHOT_PREFIX + "bob", JSON.stringify(snap("alice")));   // tampered or stale
    expect(readSnapshot(s)).toBeNull();
  });

  it("ignores broken or old-format copies", () => {
    expect(isSnapshot(null)).toBe(false);
    expect(isSnapshot({ ...snap("a"), v: 0 })).toBe(false);
    expect(isSnapshot({ ...snap("a"), role: "institution_admin" })).toBe(false);
    expect(isSnapshot({ ...snap("a"), timetable: "x" })).toBe(false);
    const s = memory();
    s.setItem(CURRENT_KEY, "a"); s.setItem(SNAPSHOT_PREFIX + "a", "{not json");
    expect(readSnapshot(s)).toBeNull();
  });

  it("syncs again after ten minutes, or at once for a new person", () => {
    const s = memory();
    expect(syncDue("alice", Date.now(), 600_000, s)).toBe(true);
    saveSnapshot(snap("alice"), s);
    expect(syncDue("alice", Date.now(), 600_000, s)).toBe(false);
    expect(syncDue("alice", Date.now() + 601_000, 600_000, s)).toBe(true);
    expect(syncDue("bob", Date.now(), 600_000, s)).toBe(true);
  });
});

describe("offline screens", () => {
  const slots = [
    { weekday: 3, starts_at: "08:00:00", ends_at: "09:30:00", id: "a" },
    { weekday: 3, starts_at: "11:00:00", ends_at: "12:00:00", id: "b" },
    { weekday: 4, starts_at: "08:00:00", ends_at: "09:00:00", id: "c" },
  ];
  it("works out now and next from the weekly timetable", () => {
    expect(nowAndNext(slots, 3, "08:15")).toMatchObject({ current: { id: "a" }, next: { id: "b" } });
    expect(nowAndNext(slots, 3, "09:30")).toMatchObject({ current: null, next: { id: "b" } });
    expect(nowAndNext(slots, 3, "12:30")).toMatchObject({ current: null, next: null });
    expect(nowAndNext(slots, 5, "08:00").today).toHaveLength(0);
  });

  it("opens the part of the screen for the page that couldn't load", () => {
    expect(tabFor("/student/timetable")).toBe("timetable");
    expect(tabFor("/lecturer/timetable?all=1")).toBe("timetable");
    expect(tabFor("/student/history?when=week")).toBe("history");
    expect(tabFor("/student/map")).toBe("venues");
    expect(tabFor("/lecturer/modules/123")).toBe("modules");
    expect(tabFor("/student")).toBe("home");
    expect(tabFor(null)).toBe("home");
  });

  it("only returns to this site's own pages", () => {
    expect(safeReturn("/student/timetable?x=1")).toBe("/student/timetable?x=1");
    expect(safeReturn("//evil.example")).toBe("/dashboard");
    expect(safeReturn("https://evil.example")).toBe("/dashboard");
    expect(safeReturn("/\\evil.example")).toBe("/dashboard");
    expect(safeReturn("/offline?from=/x")).toBe("/dashboard");
    expect(safeReturn(null)).toBe("/dashboard");
  });

  it("says when the copy was made", () => {
    const now = Date.parse("2026-11-18T10:00:00Z");
    expect(updatedAgo("2026-11-18T09:59:40Z", now)).toBe("just now");
    expect(updatedAgo("2026-11-18T09:55:00Z", now)).toBe("5 minutes ago");
    expect(updatedAgo("2026-11-18T09:00:00Z", now)).toBe("1 hour ago");
    expect(updatedAgo("2026-11-16T10:00:00Z", now)).toBe("2 days ago");
    expect(updatedAgo("2026-10-01T10:00:00Z", now)).toBe("1 October 2026");
    expect(updatedAgo("nonsense", now)).toBe("unknown");
  });
});

describe("app lock wording", () => {
  it("names what the phone will ask for", () => {
    expect(nativeLabel(3, true)).toBe("fingerprint or screen lock");
    expect(nativeLabel(4, true)).toBe("face or screen lock");
    expect(nativeLabel(6, true)).toBe("fingerprint, face or screen lock");
    expect(nativeLabel(7, false)).toBe("screen lock (PIN, pattern or password)");
  });
});

describe("Android download manifest", () => {
  const good = {
    v: 1, platform: "android", version: "1.0", versionCode: 1, build: "release", file: "uniattend-1.0-1.apk",
    url: "/downloads/uniattend-1.0-1.apk", bytes: 5_400_000, sha256: "a".repeat(64), minAndroid: "7.0", publishedAt: "2026-11-18T08:00:00Z",
  };
  it("accepts a published release", () => {
    expect(parseRelease(good)).toMatchObject({ version: "1.0", build: "release", bytes: 5_400_000 });
    expect(parseRelease({ ...good, url: "https://github.com/x/y/releases/download/v1/uniattend.apk" })?.url).toMatch(/^https:/);
    expect(parseRelease({ ...good, build: "debug" })?.build).toBe("test");
  });
  it("rejects anything odd, so the page shows no download", () => {
    expect(parseRelease(null)).toBeNull();
    expect(parseRelease({ ...good, platform: "ios" })).toBeNull();
    expect(parseRelease({ ...good, sha256: "xyz" })).toBeNull();
    expect(parseRelease({ ...good, url: "http://example.com/a.apk" })).toBeNull();
    expect(parseRelease({ ...good, url: "javascript:alert(1)" })).toBeNull();
    expect(parseRelease({ ...good, url: "/downloads/../secret.apk" })).toBeNull();
    expect(parseRelease({ ...good, file: "a.exe" })).toBeNull();
    expect(parseRelease({ ...good, bytes: 0 })).toBeNull();
  });
  it("shows sizes people read", () => {
    expect(formatBytes(5_400_000)).toBe("5.1 MB");
    expect(formatBytes(2048)).toBe("2 KB");
  });
});
