import Link from "next/link";
import { Icon } from "@/components/icons";
import { ROLE_HOME, type Role } from "@/lib/auth";

const LABEL: Record<Role, { text: string; icon: "shield" | "building" | "book" | "user" }> = {
  super_admin: { text: "Super", icon: "shield" },
  institution_admin: { text: "Admin", icon: "building" },
  lecturer: { text: "Lecturer", icon: "book" },
  student: { text: "Student", icon: "user" },
};

/**
 * Switch between the areas of the roles this user holds (e.g. a lecturer who is
 * also an institution admin). Hidden when there is only one. Each area still
 * checks the role on the server; this is only navigation.
 */
export function RoleSwitch({ roles, active, className = "" }: { roles: Role[]; active: Role; className?: string }) {
  if (roles.length < 2) return null;
  return (
    // Own light background, so it stays readable on a dark or brand-coloured top bar.
    <nav aria-label="Switch role" className={`rounded-xl border border-line bg-surface p-1 text-sm text-ink ${className}`}>
      <ul className="flex gap-1">
        {roles.map((r) => {
          const on = r === active;
          return (
            <li key={r} className="flex-1">
              <Link href={ROLE_HOME[r]} aria-current={on ? "page" : undefined}
                className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 font-medium whitespace-nowrap transition ${
                  on ? "bg-brand text-brand-ink shadow-sm" : "opacity-70 hover:bg-black/5 hover:opacity-100"}`}>
                <Icon name={LABEL[r].icon} size={16} />
                {LABEL[r].text}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
