import Link from "next/link";
import { Captcha } from "@/components/captcha";
import { ActionForm } from "@/components/form";
import { Field, Input } from "@/components/ui";
import { signUp } from "../actions";

export const metadata = { title: "Create account" };

export default function Signup() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Create your account</h1>
        <p className="text-sm text-muted">
          Use the email your institution has on record (for students, usually your university email). Your
          student or lecturer access is linked automatically once you confirm it.
        </p>
      </div>
      <ActionForm action={signUp} submit="Create account" pending="Creating…">
        <Field label="Full name"><Input name="full_name" autoComplete="name" required /></Field>
        <Field label="Email"><Input name="email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required /></Field>
        <Field label="Password" hint="At least 10 characters.">
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
      <p className="text-sm">Already registered? <Link className="text-info underline underline-offset-2 hover:decoration-2" href="/login">Sign in</Link></p>
    </div>
  );
}
