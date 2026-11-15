import Link from "next/link";
import { signOffStep } from "@/app/admin/onboarding/actions";
import { ActionForm } from "@/components/form";
import { Icon } from "@/components/icons";
import { Input } from "@/components/ui";

export type Step = { key: string; title: string; by: "platform" | "institution" | "auto"; done: boolean; detail: string; link?: string };
export type Onboarding = { steps: Step[]; ready_for_go_live: boolean; live: boolean };

const WHO = { platform: "UniAttend", institution: "You sign this off", auto: "From your data" } as const;

/** The twelve onboarding steps. `viewer` decides which steps get sign-off buttons. */
export function OnboardingChecklist({ data, institutionId, viewer }: { data: Onboarding; institutionId: string; viewer: "admin" | "super" }) {
  const canSign = (s: Step) => (viewer === "super" ? s.by !== "auto" && s.key !== "registered" && s.key !== "approved" : s.by === "institution" && s.key !== "registered");
  return (
    <ol className="space-y-2">
      {data.steps.map((s, i) => (
        <li key={s.key} className={`flex flex-wrap items-start gap-3 rounded-2xl border p-3 ${s.done ? "border-ok/30 bg-ok/5" : "border-line"}`}>
          <span className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${s.done ? "bg-ok text-white" : "bg-bg text-muted"}`}>
            {s.done ? <Icon name="check" size={14} /> : i + 1}
          </span>
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold">{s.title} <span className="ml-1 text-xs font-normal text-muted">{WHO[s.by]}</span></p>
            <p className="text-muted">{s.detail}</p>
            {!s.done && s.link && viewer === "admin" && <Link href={s.link} className="text-xs text-info hover:underline">Go there →</Link>}
          </div>
          {canSign(s) && (s.key !== "go_live" || s.done || data.ready_for_go_live) && (
            <ActionForm action={signOffStep} submit={s.done ? "Undo" : s.key === "go_live" ? "Approve go-live" : "Sign off"} pending="…"
              className="flex flex-wrap items-center gap-2 [&>button]:h-9 [&>button]:px-3 [&>button]:text-xs [&>[role]]:w-full">
              <input type="hidden" name="institution" value={institutionId} />
              <input type="hidden" name="step" value={s.key} />
              <input type="hidden" name="undo" value={s.done ? "1" : "0"} />
              {!s.done && (s.key === "verified" || s.key === "training") && <Input name="note" placeholder="Note (optional)" className="h-9 w-48" maxLength={500} />}
            </ActionForm>
          )}
          {s.key === "go_live" && !s.done && !data.ready_for_go_live && <span className="text-xs text-muted">Waits for every step above.</span>}
        </li>
      ))}
    </ol>
  );
}
