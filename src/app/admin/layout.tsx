import { Shell } from "@/components/shell";
import { Notice } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { shellData } from "@/lib/shell-data";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const s = await requireRole("institution_admin");
  const { current, choices } = s;
  return (
    <Shell area="Administration" current={current} choices={choices} {...await shellData(s)} nav={[
      { href: "/admin", label: "Dashboard", icon: "dashboard" },
      { href: "/admin/structure", label: "Venues & map", icon: "map" },
      { href: "/admin/modules", label: "Modules", icon: "book" },
      { href: "/admin/timetable", label: "Timetable", icon: "calendar" },
      { href: "/admin/people", label: "People", icon: "users" },
      { href: "/admin/live", label: "Live map", icon: "pin" },
      { href: "/admin/early-warning", label: "Early warning", icon: "alert" },
      { href: "/admin/design", label: "Design", icon: "dashboard", mobile: false },
      { href: "/admin/settings", label: "Policy", icon: "settings", mobile: false },
      { href: "/admin/audit", label: "Audit log", icon: "shield", mobile: false },
    ]}>
      {current.institution_status !== "active" && (
        <div className="mb-6"><Notice tone="warn">
          {current.institution_status === "pending"
            ? "Your institution is awaiting approval by UniAttend. You can set up faculties, venues, modules and people now; attendance sessions open once it is approved."
            : `This institution is ${current.institution_status}. Attendance is unavailable. Contact UniAttend support.`}
        </Notice></div>
      )}
      {children}
    </Shell>
  );
}
