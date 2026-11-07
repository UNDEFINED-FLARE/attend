import Link from "next/link";
import { ActionForm } from "@/components/form";
import { Field, Input } from "@/components/ui";
import { signIn } from "../actions";

export const metadata = { title: "Sign in" };

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="text-sm text-muted">Students, lecturers and administrators all sign in here.</p>
      </div>
      <ActionForm action={signIn} submit="Sign in" pending="Signing in…">
        <input type="hidden" name="next" value={next ?? "/dashboard"} />
        <Field label="Email"><Input name="email" type="email" autoComplete="email" required /></Field>
        <Field label="Password"><Input name="password" type="password" autoComplete="current-password" required /></Field>
      </ActionForm>
      <div className="flex justify-between text-sm">
        <Link className="text-info hover:underline" href="/signup">Create an account</Link>
        <Link className="text-info hover:underline" href="/forgot-password">Forgot password?</Link>
      </div>
    </div>
  );
}
