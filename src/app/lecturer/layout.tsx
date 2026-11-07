import { Shell } from "@/components/shell";
import { requireRole } from "@/lib/auth";

export default async function LecturerLayout({ children }: { children: React.ReactNode }) {
  const { current, choices } = await requireRole("lecturer");
  return (
    <Shell area="Lecturer" current={current} choices={choices} nav={[
      { href: "/lecturer", label: "My modules" },
      { href: "/lecturer/disputes", label: "Disputes & reviews" },
    ]}>{children}</Shell>
  );
}
