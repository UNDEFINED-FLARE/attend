// A weekly timetable as an iCalendar (.ics) file: each class becomes a weekly
// repeating event that Google Calendar, Outlook and Apple Calendar import.
// South Africa has no daylight saving, so a fixed +02:00 time zone is exact.

export type IcsClass = {
  id: string; weekday: number; starts_at: string; ends_at: string; // ISO weekday, "HH:MM[:SS]"
  code: string; title: string; kind: string; venue: string | null; lecturer?: string | null;
};

const TZID = "Africa/Johannesburg";
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;

/** Escape text for an iCalendar property value. */
export function icsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1");
}

/** Fold lines longer than 75 octets, as RFC 5545 requires. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (new TextEncoder().encode(cur + ch).length > (out.length ? 74 : 75)) { out.push(cur); cur = ch; } else cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}

/** The first date on/after `from` (a SAST calendar date) that falls on ISO `weekday`. */
export function firstOn(weekday: number, from: Date): Date {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const iso = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + ((weekday - iso + 7) % 7));
  return d;
}

export function buildIcs({ name, classes, from, until, now = new Date() }: {
  name: string; classes: IcsClass[]; from: Date; until: Date; now?: Date;
}): string {
  const stamp = `${ymd(now)}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  // UNTIL is the end of the last day, in UTC (23:59:59 SAST = 21:59:59 UTC).
  const untilUtc = `${ymd(until)}T215959Z`;
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//UniAttend//Timetable//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(name)}`, `X-WR-TIMEZONE:${TZID}`,
    "BEGIN:VTIMEZONE", `TZID:${TZID}`, "BEGIN:STANDARD", "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0200", "TZOFFSETTO:+0200", "TZNAME:SAST", "END:STANDARD", "END:VTIMEZONE",
  ];
  for (const c of classes) {
    const day = firstOn(c.weekday, from);
    if (day > until) continue;
    const t = (s: string) => s.replace(/:/g, "").padEnd(6, "0").slice(0, 6);
    const kind = c.kind ? c.kind[0].toUpperCase() + c.kind.slice(1) : "Class";
    lines.push(
      "BEGIN:VEVENT",
      `UID:${c.id}@uniattend`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=${TZID}:${ymd(day)}T${t(c.starts_at)}`,
      `DTEND;TZID=${TZID}:${ymd(day)}T${t(c.ends_at)}`,
      `RRULE:FREQ=WEEKLY;UNTIL=${untilUtc}`,
      `SUMMARY:${icsText(`${c.code} ${kind}`)}`,
      `DESCRIPTION:${icsText([c.title, c.lecturer ? `Lecturer: ${c.lecturer}` : ""].filter(Boolean).join("\n"))}`,
      ...(c.venue ? [`LOCATION:${icsText(c.venue)}`] : []),
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsText(`${c.code} starts in 15 minutes`)}`, "TRIGGER:-PT15M", "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
