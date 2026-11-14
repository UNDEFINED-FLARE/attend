import { Shell } from "@/components/shell";
import { requireRole } from "@/lib/auth";
import { menuFor } from "@/lib/nav-config";
import { shellData } from "@/lib/shell-data";

export default async function LecturerLayout({ children }: { children: React.ReactNode }) {
  const s = await requireRole("lecturer");
  const shell = await shellData(s);
  return (
    <Shell area="Lecturer" current={s.current} choices={s.choices} {...shell} nav={menuFor("lecturer", shell.theme)}>{children}</Shell>
  );
}
