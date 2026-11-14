// Work done without signal, kept on the phone until it can be sent.
//
// Each item belongs to the person who made it: it is only ever sent while that
// same person is signed in, so a shared phone can't send one student's check-in
// as another's. Items are small (a check-in's evidence, a register's changes),
// so localStorage is enough, and it survives the app being closed.

export type CheckInPayload = {
  session: string | null; code: string | null; token: string | null;
  gps: { samples: { lat: number; lng: number; accuracy: number }[] } | null;
  device: string | null; captured_at: string;
};
export type RegisterPayload = { session: string; entries: unknown[]; note: string; label: string };

export type QueueItem =
  | { id: string; userId: string; kind: "checkin"; payload: CheckInPayload; created_at: string; tries: number; error?: string }
  | { id: string; userId: string; kind: "register"; payload: RegisterPayload; created_at: string; tries: number; error?: string };

const KEY = "ua_offline_queue_v1";
export const QUEUE_EVENT = "ua-queue-changed";
const MAX_ITEMS = 50;

function read(): QueueItem[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? (v as QueueItem[]) : [];
  } catch { return []; }
}
function write(items: QueueItem[]) {
  try { localStorage.setItem(KEY, JSON.stringify(items.slice(-MAX_ITEMS))); } catch { /* storage full or blocked */ }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(QUEUE_EVENT));
}

export const queued = (userId: string) => read().filter((i) => i.userId === userId);

export function enqueue(item: Omit<QueueItem, "id" | "created_at" | "tries">): QueueItem {
  const full = { ...item, id: crypto.randomUUID(), created_at: new Date().toISOString(), tries: 0 } as QueueItem;
  const items = read();
  // One check-in per session (or code) is enough; a newer register save replaces an older one.
  const same = (i: QueueItem) => i.userId === full.userId && i.kind === full.kind && (full.kind === "checkin"
    ? (i.payload as CheckInPayload).session === full.payload.session && (i.payload as CheckInPayload).code === full.payload.code
    : (i.payload as RegisterPayload).session === (full.payload as RegisterPayload).session);
  const earlier = items.find(same);
  if (earlier && full.kind === "checkin") return earlier;
  write([...items.filter((i) => i !== earlier), full]);
  return full;
}

export function remove(id: string) { write(read().filter((i) => i.id !== id)); }
export function markFailed(id: string, error: string) {
  write(read().map((i) => (i.id === id ? { ...i, tries: i.tries + 1, error } : i)));
}

/** A failed request that means "no connection", as opposed to an answer from the server. */
export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  const m = String((e as Error)?.message ?? e);
  return e instanceof TypeError || /fetch|network|load failed|connection|offline/i.test(m);
}
