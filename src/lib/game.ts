// Figures for the student app's game look (lib/look.ts), worked out from the student's own records.
// Nothing is invented: a streak is real classes in a row, and a slot's result is that class's real record.

import { sastDay } from "@/lib/stats";

export type GameRec = {
  status: string;
  created_at: string;
  modules: { code: string } | null;
  class_sessions: { opens_at: string } | null;
};

const ATTENDED = new Set(["present", "late", "late_pending"]);
const NEUTRAL = new Set(["excused", "pending_verification", "disputed"]);

/**
 * Classes attended in a row, newest first, up to the first absence.
 * Excused and undecided records neither count nor break the run.
 */
export function attendanceStreak(recs: Pick<GameRec, "status" | "created_at">[]): number {
  const newest = [...recs].sort((a, b) => b.created_at.localeCompare(a.created_at));
  let n = 0;
  for (const r of newest) {
    if (ATTENDED.has(r.status)) n++;
    else if (!NEUTRAL.has(r.status)) break;
  }
  return n;
}

export type SlotState = "now" | "next" | "later" | "ended" | "present" | "late" | "absent" | "review" | "excused";

const sastHHMM = (iso: string) => new Date(new Date(iso).getTime() + 2 * 3600_000).toISOString().slice(11, 16);
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * What one of today's timetable slots shows. A record for the same module whose class opened today,
 * from 30 minutes before the slot until its end, gives the result; otherwise the clock decides.
 * `start`, `end` and `now` are "HH:MM" in South African time; `today` is "YYYY-MM-DD".
 */
export function slotState(slot: { code: string; start: string; end: string }, now: string, today: string,
  recs: GameRec[], isNext: boolean): SlotState {
  const from = minutes(slot.start) - 30, to = minutes(slot.end);
  const rec = recs.find((r) => {
    const opens = r.class_sessions?.opens_at;
    if (r.modules?.code !== slot.code || !opens || sastDay(opens) !== today) return false;
    const at = minutes(sastHHMM(opens));
    return at >= from && at < to;
  });
  if (rec) {
    if (rec.status === "present") return "present";
    if (rec.status === "late" || rec.status === "late_pending") return "late";
    if (rec.status === "absent") return "absent";
    if (rec.status === "excused") return "excused";
    return "review";
  }
  if (slot.start <= now && now < slot.end) return "now";
  if (slot.end <= now) return "ended";
  return isNext ? "next" : "later";
}

export type CardTier = "top" | "ok" | "risk" | "none";

/** A module card's frame: 90% or more, on track, below the module's requirement, or no classes yet. */
export function cardTier(percent: number | null, min: number): CardTier {
  if (percent == null) return "none";
  if (percent < min) return "risk";
  return percent >= 90 ? "top" : "ok";
}
