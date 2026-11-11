import { Shell } from "@/components/shell";
import { Notice } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { menuFor } from "@/lib/nav-config";
import { shellData } from "@/lib/shell-data";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const s = await requireRole("institution_admin");
  const { current, choices } = s;
  const shell = await shellData(s);
  return (
    <Shell area="Administration" current={current} choices={choices} {...shell} nav={menuFor("admin", shell.theme)}>
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
