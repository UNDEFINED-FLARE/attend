import { Shell } from "@/components/shell";
import { requireRole } from "@/lib/auth";
import { shellData } from "@/lib/shell-data";

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const s = await requireRole("student");
  return (
    <Shell area="Student" app={{ center: "/student/check-in" }} current={s.current} choices={s.choices} {...await shellData(s)} nav={[
      { href: "/student", label: "Home", icon: "dashboard" },
      { href: "/student/timetable", label: "Timetable", icon: "calendar" },
      { href: "/student/check-in", label: "Check in", icon: "scan" },
      { href: "/student/map", label: "Map", icon: "map" },
      { href: "/student/history", label: "History", icon: "history" },
    ]}>{children}</Shell>
  );
}
