import { Shell } from "@/components/shell";
import { Notice } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { menuFor } from "@/lib/nav-config";
import { shellData } from "@/lib/shell-data";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const s = await requireRole("institution_admin");
  const { current, choices } = s;
  const [shell, { data: notice }] = await Promise.all([
    shellData(s),
    s.supabase.rpc("subscription_notice", { p_inst: s.institutionId }),
  ]);
  const sub = notice as { plan: string; status: string; ends_at: string | null; days_left: number | null; operating: boolean } | null;
  const ends = sub?.ends_at ? new Date(sub.ends_at).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Johannesburg" }) : null;
  return (
    <Shell area="Administration" current={current} choices={choices} {...shell} nav={menuFor("admin", shell.theme)}>
      {current.institution_status !== "active" && (
        <div className="mb-6"><Notice tone="warn">
          {current.institution_status === "pending"
            ? "Your institution is awaiting approval by UniAttend. You can set up faculties, venues, modules and people now; attendance sessions open once it is approved."
            : `This institution is ${current.institution_status}. Attendance is unavailable. Contact UniAttend support.`}
        </Notice></div>
      )}
      {current.institution_status === "active" && sub && !sub.operating && (
        <div className="mb-6"><Notice tone="bad">
          Your UniAttend {sub.status === "trialing" ? "trial" : "subscription"} {ends ? `ended on ${ends}` : "has ended"}. Attendance sessions and check-ins are paused; all your data is kept. Contact UniAttend to continue.
        </Notice></div>
      )}
      {current.institution_status === "active" && sub?.operating && sub.days_left != null && sub.days_left <= 14 && (sub.status === "trialing" || sub.status === "active") && (
        <div className="mb-6"><Notice tone="warn">
          Your UniAttend {sub.status === "trialing" ? "trial" : "subscription"} ends on {ends} ({sub.days_left <= 0 ? "today" : `in ${sub.days_left} day${sub.days_left === 1 ? "" : "s"}`}).
          {sub.status === "trialing" ? " Attendance pauses when it ends unless it's extended or paid." : " Renew before then to keep attendance running."} Contact UniAttend to continue.
        </Notice></div>
      )}
      {children}
    </Shell>
  );
}
