import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppLock } from "@/components/app-lock";
import { Icon } from "@/components/icons";
import { getSession, INST_COOKIE, ROLE_HOME } from "@/lib/auth";
import { loadTheme } from "@/lib/shell-data";
import { themeStyle } from "@/lib/theme";
import { AppLockSettings } from "./app-lock-settings";

export const metadata = { title: "Security" };

export default async function Settings() {
  const s = await getSession();
  if (!s) redirect("/login?next=/settings");
  const wanted = (await cookies()).get(INST_COOKIE)?.value;
  const role = s.roles.find((r) => r.institution_id === wanted) ?? s.roles.find((r) => r.institution_id) ?? s.roles[0];
  const theme = await loadTheme(s.supabase, role?.institution_id ?? null);
  const name = (s.user.user_metadata as { full_name?: string } | undefined)?.full_name || s.user.email || "you";
  const instName = theme.header.title || role?.institution_name || "UniAttend";

  return (
    <div style={themeStyle(theme)} className="min-h-dvh font-sans">
      <AppLock userId={s.user.id} name={name} institution={instName} logo={theme.header.logoUrl || null} />
      <main data-lockable className="mx-auto max-w-2xl space-y-5 px-4 pb-16 pt-[max(20px,env(safe-area-inset-top))]">
        <div className="flex items-center gap-3">
          <Link href={role ? ROLE_HOME[role.role] : "/dashboard"} className="grid size-11 place-items-center rounded-2xl bg-surface shadow-card" aria-label="Back">
            <Icon name="arrowRight" size={18} className="rotate-180" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Security</h1>
            <p className="text-sm text-muted">{name} · {instName}</p>
          </div>
        </div>
        <AppLockSettings userId={s.user.id} name={name} />
        <Link href="/notifications" className="flex items-center gap-3 rounded-3xl bg-surface p-4 text-sm font-medium shadow-card">
          <Icon name="bell" size={20} className="text-accent" />Notification settings<Icon name="arrowRight" size={16} className="ml-auto text-muted" />
        </Link>
        <Link href="/forgot-password" className="flex items-center gap-3 rounded-3xl bg-surface p-4 text-sm font-medium shadow-card">
          <Icon name="lock" size={20} className="text-accent" />Change my password<Icon name="arrowRight" size={16} className="ml-auto text-muted" />
        </Link>
      </main>
    </div>
  );
}
