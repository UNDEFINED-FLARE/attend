import { requireRole } from "@/lib/auth";
import { myTimetable } from "@/lib/student-data";
import { timetableIcs } from "@/lib/timetable-export";

// The student's timetable as a calendar file (Google, Outlook, Apple Calendar).
export async function GET() {
  const { supabase, institutionId, current } = await requireRole("student");
  const slots = await myTimetable(supabase, institutionId);
  return timetableIcs(supabase, institutionId, `${current.institution_name ?? "UniAttend"} timetable`, "my-timetable", slots);
}
