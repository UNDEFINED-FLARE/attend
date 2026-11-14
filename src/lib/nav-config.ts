// Every menu in the app, with the defaults an institution starts from. The Design
// page lets admins rename, hide and reorder items; features switched off remove
// their items. Some items can't be hidden, so nobody locks themselves out.
import type { IconName } from "@/components/icons";
import type { NavItem } from "@/components/nav";
import type { Theme } from "@/lib/theme";

export type MenuRole = "student" | "lecturer" | "admin";
export type FeatureKey = keyof Theme["features"];
type Def = NavItem & { feature?: FeatureKey; locked?: boolean };

export const MENUS: Record<MenuRole, Def[]> = {
  student: [
    { href: "/student", label: "Home", icon: "dashboard", locked: true },
    { href: "/student/timetable", label: "Timetable", icon: "calendar" },
    { href: "/student/check-in", label: "Check in", icon: "scan", locked: true },
    { href: "/student/map", label: "Map", icon: "map" },
    { href: "/student/history", label: "History", icon: "history" },
  ],
  lecturer: [
    { href: "/lecturer", label: "Home", icon: "dashboard", locked: true },
    { href: "/lecturer/timetable", label: "Timetable", icon: "calendar" },
    { href: "/lecturer/disputes", label: "Reviews", icon: "flag" },
    { href: "/lecturer/early-warning", label: "Early warning", icon: "alert", feature: "earlyWarning" },
    { href: "/notifications", label: "Alerts", icon: "bell" },
  ],
  admin: [
    { href: "/admin", label: "Dashboard", icon: "dashboard", locked: true },
    { href: "/admin/data", label: "Data", icon: "file" },
    { href: "/admin/structure", label: "Venues & map", icon: "map" },
    { href: "/admin/modules", label: "Modules", icon: "book" },
    { href: "/admin/timetable", label: "Timetable", icon: "calendar" },
    { href: "/admin/people", label: "People", icon: "users" },
    { href: "/admin/integrations/import", label: "Import data", icon: "file", mobile: false },
    { href: "/admin/connections", label: "Connections", icon: "history", mobile: false },
    { href: "/admin/early-warning", label: "Early warning", icon: "alert", feature: "earlyWarning" },
    { href: "/admin/design", label: "Design", icon: "dashboard", mobile: false, locked: true },
    { href: "/admin/settings", label: "Policy", icon: "settings", mobile: false },
    { href: "/admin/audit", label: "Audit log", icon: "shield", mobile: false },
  ],
};

export const MENU_ROLE_LABEL: Record<MenuRole, string> = { student: "Students", lecturer: "Lecturers", admin: "Administrators" };

/** A role's menu after the institution's renames, hidden items, order and feature switches. */
export function menuFor(role: MenuRole, theme: Theme): NavItem[] {
  const defs = MENUS[role];
  const saved = theme.menus[role] ?? [];
  const byHref = new Map(defs.map((d) => [d.href, d]));
  const ordered: Def[] = [
    ...saved.flatMap((s) => (byHref.has(s.href) ? [{ ...byHref.get(s.href)!, label: s.label.trim() || byHref.get(s.href)!.label, hidden: !s.show }] : [])),
    // items added to the app after the institution last saved its menu
    ...defs.filter((d) => !saved.some((s) => s.href === d.href)),
  ] as (Def & { hidden?: boolean })[];
  return ordered
    .filter((d) => !(d.feature && !theme.features[d.feature]))
    .filter((d) => d.locked || !(d as { hidden?: boolean }).hidden)
    .map(({ href, label, icon, mobile }) => ({ href, label, icon: icon as IconName, mobile }));
}

/** The default menu entries, for the Design page and for a reset. */
export const defaultMenus = (): Theme["menus"] => ({
  student: MENUS.student.map((d) => ({ href: d.href, label: d.label, show: true })),
  lecturer: MENUS.lecturer.map((d) => ({ href: d.href, label: d.label, show: true })),
  admin: MENUS.admin.map((d) => ({ href: d.href, label: d.label, show: true })),
});
