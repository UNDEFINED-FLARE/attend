import { loadTheme } from "@/lib/shell-data";
import { requireRole } from "@/lib/auth";
import { teachingTimetable, timetableIcs } from "@/lib/timetable-export";

// The lecturer's teaching timetable as a calendar file. ?all=1 includes classes taught by colleagues.
export async function GET(request: Request) {
  const { supabase, institutionId, current, user } = await requireRole("lecturer");
  if (!(await loadTheme(supabase, institutionId)).features.calendarDownload) return new Response("Timetable download is switched off.", { status: 404 });
  const all = new URL(request.url).searchParams.get("all") === "1";
  const slots = (await teachingTimetable(supabase, institutionId, user.id)).filter((s) => all || s.mine);
  return timetableIcs(supabase, institutionId, `${current.institution_name ?? "UniAttend"} teaching`, "teaching-timetable", slots);
}
