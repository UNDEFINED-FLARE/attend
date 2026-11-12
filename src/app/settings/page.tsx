import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppLock } from "@/components/app-lock";
import { ActionForm } from "@/components/form";
import { Icon } from "@/components/icons";
import { getSession, INST_COOKIE, ROLE_HOME } from "@/lib/auth";
import { loadTheme } from "@/lib/shell-data";
import { themeStyle } from "@/lib/theme";
import { leaveInstitution } from "./actions";
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
  const ROLE_NAME: Record<string, string> = { institution_admin: "Administrator", lecturer: "Lecturer", student: "Student" };
  const memberships = [...new Set(s.roles.filter((r) => r.institution_id).map((r) => r.institution_id as string))].map((iid) => ({
    id: iid,
    name: s.roles.find((r) => r.institution_id === iid)?.institution_name ?? "Institution",
    roles: s.roles.filter((r) => r.institution_id === iid).map((r) => ROLE_NAME[r.role] ?? r.role),
  }));

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
        {memberships.length > 0 && (
          <section className="space-y-3 rounded-3xl bg-surface p-5 shadow-card">
            <div>
              <h2 className="font-semibold">Your institutions</h2>
              <p className="text-sm text-muted">Where your account has access. If one of these isn&apos;t yours, leave it: its administrators can&apos;t add you back.</p>
            </div>
            <ul className="space-y-2">
              {memberships.map((m) => (
                <li key={m.id} className="rounded-2xl border border-line p-3">
                  <p className="text-sm font-semibold">{m.name}</p>
                  <p className="text-xs text-muted">{m.roles.join(", ")}</p>
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer text-xs font-medium text-bad">Leave this institution</summary>
                    <div className="mt-2">
                      <ActionForm action={leaveInstitution} submit="Leave" pending="Leaving…" className="space-y-2">
                        <input type="hidden" name="institution" value={m.id} />
                        <label className="flex items-start gap-2 text-xs">
                          <input type="checkbox" name="confirm" className="mt-0.5 size-4" />
                          I understand I lose access to {m.name}, and only UniAttend support can restore it.
                        </label>
                      </ActionForm>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </section>
        )}
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
