// Converts events from timetable.univen.ac.za's JSON into ParsedClass rows.
// Pure (no server-only imports) so it can be unit-tested.
import { venueName, type ParsedClass } from "@/lib/timetable-pdf";

export type UnivenEvent = {
  eventId: number; moduleName: string; dayOfWeek: number; startTime: string; endTime: string;
  rooms: { name: string; capacity: number | null }[]; staff: string[]; groups: { name: string; studentCount: number | null }[];
};

const WHERE_RE = /^BUILDING\s*:\s*(.+?)\s*@\s*ROOM\s*:\s*(.+)$/i;
const CODE_RE = /^[A-Z]{2,6}\d{3,5}[A-Z]?$/;

/** "ECS1245_2" -> "Group 2"; several groups joined. */
export function groupLabel(groups: UnivenEvent["groups"]): string | null {
  const labels = groups.map((g) => /_(\w+)$/.exec(g.name)?.[1]).filter(Boolean).map((n) => `Group ${n}`);
  return labels.length ? [...new Set(labels)].join(", ").slice(0, 40) : null;
}

export function eventToClass(e: UnivenEvent): ParsedClass | null {
  const code = e.moduleName?.replace(/\s+/g, "").toUpperCase();
  if (!code || !CODE_RE.test(code)) return null;
  if (!(e.dayOfWeek >= 0 && e.dayOfWeek <= 6)) return null; // the viewer counts Monday as 0
  const t = (s: string) => (/^\d{1,2}:\d{2}/.test(s) ? s.slice(0, 5).padStart(5, "0") : null);
  const starts_at = t(e.startTime), ends_at = t(e.endTime);
  if (!starts_at || !ends_at || ends_at <= starts_at) return null;
  const room = e.rooms?.[0];
  const where = room ? WHERE_RE.exec(room.name ?? "") : null;
  const online = !room || /^online$/i.test(room.name ?? "");
  return {
    code, weekday: e.dayOfWeek + 1, starts_at, ends_at, online,
    building: where?.[1].trim() ?? null, room: where?.[2].trim() ?? null,
    venue: !online && where ? venueName(where[1], where[2]) : null,
    lecturer: e.staff?.[0]?.trim().replace(/\s+/g, " ") || null,
    group: groupLabel(e.groups ?? []),
    capacity: room?.capacity && room.capacity > 0 ? Math.min(room.capacity, 10000) : null,
    sourceId: e.eventId,
  };
}

