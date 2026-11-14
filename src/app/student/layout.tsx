import { Shell } from "@/components/shell";
import { requireRole } from "@/lib/auth";
import { NativeReminders } from "@/components/native-reminders";
import { menuFor } from "@/lib/nav-config";
import { shellData } from "@/lib/shell-data";
import { myTimetable } from "@/lib/student-data";

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const s = await requireRole("student");
  const [shell, slots] = await Promise.all([shellData(s), myTimetable(s.supabase, s.institutionId)]);
  return (
    <Shell area="Student" app={{ center: "/student/check-in" }} current={s.current} choices={s.choices} {...shell} nav={menuFor("student", shell.theme)}>
      <NativeReminders institution={shell.theme.header.title || s.current.institution_name || "UniAttend"}
        slots={slots.map((t) => ({ id: t.id, weekday: t.weekday, starts_at: t.starts_at, ends_at: t.ends_at, code: t.code, title: t.title, kind: t.kind, venue: t.venue }))} />
      {children}
    </Shell>
  );
}
