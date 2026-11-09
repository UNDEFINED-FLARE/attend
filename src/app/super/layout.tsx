import { Shell } from "@/components/shell";
import { requireRole } from "@/lib/auth";
import { shellData } from "@/lib/shell-data";

export default async function SuperLayout({ children }: { children: React.ReactNode }) {
  const s = await requireRole("super_admin");
  return (
    <Shell area="Platform" current={{ ...s.current, institution_name: "Platform administration" }} choices={[]} {...await shellData(s)} nav={[
      { href: "/super", label: "Institutions", icon: "building" },
      { href: "/super/directory", label: "Directory", icon: "map" },
      { href: "/super/plans", label: "Plans & pricing", icon: "card" },
      { href: "/notifications", label: "Alerts", icon: "bell" },
    ]}>{children}</Shell>
  );
}
