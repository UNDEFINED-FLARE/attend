import Link from "next/link";
import { Captcha } from "@/components/captcha";
import { ActionForm } from "@/components/form";
import { Field, Input, Notice } from "@/components/ui";
import { SLUG } from "@/lib/sign-in";
import { loadDirectory } from "@/lib/sign-in-server";
import { signUp } from "../actions";

export const metadata = { title: "Set up access" };

/**
 * Email accounts exist only for the transition: for an institution that hasn't
 * connected its university sign-in yet (migration 0036). Everywhere else people
 * sign in with their university account, so there is nothing to register here.
 */
export default async function Signup({ searchParams }: { searchParams: Promise<{ i?: string }> }) {
  const { i } = await searchParams;
  const { list } = i && SLUG.test(i) ? await loadDirectory(i) : { list: [] };
  const inst = list[0];

  if (!inst || inst.method !== "email") {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">No registration needed</h1>
          <p className="text-sm text-muted">Students and lecturers don&apos;t create UniAttend accounts. You sign in with your institution&apos;s existing account.</p>
        </div>
        {inst?.method === "none" && <Notice tone="warn">Institution sign-in is not yet available. Please contact your university administrator.</Notice>}
        <Link href={inst ? `/login?i=${inst.slug}` : "/login"} className="inline-flex h-11 items-center rounded-xl bg-brand px-5 text-sm font-semibold text-brand-ink">Choose your institution</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Set up access at {inst.short_name ?? inst.name}</h1>
        <p className="text-sm text-muted">
          Until {inst.name} connects its university sign-in, use the email it has on record for you (for students,
          usually your university email). Your student or lecturer access appears once you confirm it, and only if
          your institution has added you.
        </p>
      </div>
      <ActionForm action={signUp} submit="Continue" pending="Setting up…">
        <input type="hidden" name="i" value={inst.slug} />
        <Field label="Full name"><Input name="full_name" autoComplete="name" required /></Field>
        <Field label="Email"><Input name="email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required /></Field>
        <Field label="Password" hint="At least 10 characters. Used only until your university sign-in is connected.">
          <Input name="password" type="password" autoComplete="new-password" minLength={10} required />
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="consent" className="mt-1" required />
          <span>I accept the <Link href="/terms" className="text-info underline">terms of service</Link>, have read the{" "}
            <Link href="/privacy" className="text-info underline">privacy notice</Link>, and understand
            how attendance, location and device data are used.</span>
        </label>
        <Captcha />
      </ActionForm>
      <p className="text-sm">Already set up? <Link className="text-info hover:underline" href={`/login?i=${inst.slug}`}>Sign in</Link></p>
    </div>
  );
}
