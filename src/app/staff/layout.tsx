import { Shell } from "@/components/shell";
import type { NavItem } from "@/components/nav";
import { requireAnyRole, STAFF_ROLES } from "@/lib/auth";
import { shellData } from "@/lib/shell-data";

// Faculty and department administrators, attendance officers and auditors.
// What each one sees is decided by the database (may_view_module and friends).
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const s = await requireAnyRole(STAFF_ROLES);
  const shell = await shellData(s);
  const nav: NavItem[] = [
    { href: "/staff", label: "Overview", icon: "dashboard" },
    { href: "/staff/review", label: "Reviews", icon: "flag" },
    { href: "/staff/reports", label: "Reports", icon: "chart" },
    ...(s.roles.some((r) => r.role === "auditor") ? [{ href: "/staff/audit", label: "Audit log", icon: "shield" as const }] : []),
    { href: "/notifications", label: "Alerts", icon: "bell" },
  ];
  return <Shell area="Attendance oversight" current={s.current} choices={s.choices} {...shell} nav={nav}>{children}</Shell>;
}
