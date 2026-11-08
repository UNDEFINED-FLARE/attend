import { Shell } from "@/components/shell";
import { requireRole } from "@/lib/auth";
import { shellData } from "@/lib/shell-data";

export default async function LecturerLayout({ children }: { children: React.ReactNode }) {
  const s = await requireRole("lecturer");
  return (
    <Shell area="Lecturer" current={s.current} choices={s.choices} {...await shellData(s)} nav={[
      { href: "/lecturer", label: "Home", icon: "dashboard" },
      { href: "/lecturer/disputes", label: "Reviews", icon: "flag" },
      { href: "/notifications", label: "Alerts", icon: "bell" },
    ]}>{children}</Shell>
  );
}
