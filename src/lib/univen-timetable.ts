import "server-only";
import type { ParsedClass } from "@/lib/timetable-pdf";
import { eventToClass, type UnivenEvent } from "@/lib/univen-events";

// Reader for the University of Venda's public timetable viewer
// (https://timetable.univen.ac.za). Its app loads JSON from two endpoints:
//   GET /api/courses                    -> [{ courseId, name }]
//   GET /api/timetable/course/{id}      -> { courseName, events: [...] }
// No sign-in is required. We fetch politely: few requests at a time, a clear
// User-Agent, a timeout, and one retry.

const BASE = "https://timetable.univen.ac.za/api";
const UA = "UniAttend timetable import (attendance pilot)";

export type UnivenCourse = { id: number; name: string };



async function getJson<T>(path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(`${BASE}${path}`, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(20_000), cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as T;
    } catch (e) {
      if (attempt >= 1) throw e;
      await new Promise((res) => setTimeout(res, 800));
    }
  }
}

export async function fetchUnivenCourses(): Promise<UnivenCourse[]> {
  const list = await getJson<{ courseId: number; name: string }[]>("/courses");
  return list.filter((c) => Number.isInteger(c.courseId) && c.name).map((c) => ({ id: c.courseId, name: c.name.trim() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Classes for the given programmes, fetched 4 at a time; shared classes counted once. */
export async function fetchUnivenClasses(ids: number[]): Promise<{ classes: ParsedClass[]; failed: number[] }> {
  const byEvent = new Map<number, ParsedClass>();
  const failed: number[] = [];
  const queue = [...ids];
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    for (let id = queue.shift(); id != null; id = queue.shift()) {
      try {
        const j = await getJson<{ events: UnivenEvent[] }>(`/timetable/course/${id}`);
        for (const e of j.events ?? []) {
          const c = eventToClass(e);
          if (c && !byEvent.has(e.eventId)) byEvent.set(e.eventId, c);
        }
      } catch {
        failed.push(id);
      }
    }
  }));
  return { classes: [...byEvent.values()], failed };
}
