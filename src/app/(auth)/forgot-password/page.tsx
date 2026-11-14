import Link from "next/link";
import { Captcha } from "@/components/captcha";
import { ActionForm } from "@/components/form";
import { Field, Input } from "@/components/ui";
import { requestReset } from "../actions";

export const metadata = { title: "Reset password" };

export default function Forgot() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Reset your password</h1>
      <ActionForm action={requestReset} submit="Send reset link" pending="Sending…">
        <Field label="Email"><Input name="email" type="email" autoComplete="email" required /></Field>
        <Captcha />
      </ActionForm>
      <Link className="text-sm text-info hover:underline" href="/login">Back to sign in</Link>
    </div>
  );
}
