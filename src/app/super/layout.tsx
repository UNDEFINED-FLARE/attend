import { Shell } from "@/components/shell";
import { requireRole } from "@/lib/auth";

export default async function SuperLayout({ children }: { children: React.ReactNode }) {
  const { current } = await requireRole("super_admin");
  return (
    <Shell area="Platform" current={{ ...current, institution_name: "UniAttend platform" }} choices={[]} nav={[
      { href: "/super", label: "Institutions" },
      { href: "/super/plans", label: "Plans & pricing" },
    ]}>{children}</Shell>
  );
}
