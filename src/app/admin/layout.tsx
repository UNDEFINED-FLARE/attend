import { Shell } from "@/components/shell";
import { Notice } from "@/components/ui";
import { requireRole } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { current, choices } = await requireRole("institution_admin");
  return (
    <Shell area="Administration" current={current} choices={choices} nav={[
      { href: "/admin", label: "Overview" },
      { href: "/admin/structure", label: "Faculties & venues" },
      { href: "/admin/modules", label: "Modules" },
      { href: "/admin/people", label: "Lecturers & students" },
      { href: "/admin/settings", label: "Policy & branding" },
      { href: "/admin/audit", label: "Audit log" },
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
