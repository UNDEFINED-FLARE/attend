import Link from "next/link";
import { LoginForm } from "../login-form";

export const metadata = { title: "Institution administrator sign in" };

// Administrators keep an email sign-in: if their university's sign-in is down, they
// must still be able to reach UniAttend. Signing in gives no role by itself; what an
// administrator may do comes only from the roles the institution or UniAttend granted.
export default async function AdminLogin({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Institution administrator sign in</h1>
        <p className="text-sm text-muted">For people who run UniAttend at their university. Use the email you were added with.</p>
      </div>
      <LoginForm next={next ?? "/dashboard"} />
      <div className="flex justify-between text-sm">
        <Link className="text-info hover:underline" href="/login">Student or lecturer? Sign in here</Link>
        <Link className="text-info hover:underline" href="/forgot-password">Forgot password?</Link>
      </div>
    </div>
  );
}
