import { Shell } from "@/components/shell";
import { requireRole } from "@/lib/auth";

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const { current, choices } = await requireRole("student");
  return (
    <Shell area="Student" current={current} choices={choices} nav={[
      { href: "/student", label: "Overview" },
      { href: "/student/check-in", label: "Check in" },
      { href: "/student/history", label: "History & disputes" },
    ]}>{children}</Shell>
  );
}
