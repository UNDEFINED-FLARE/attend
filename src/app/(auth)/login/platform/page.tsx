import Link from "next/link";
import { LoginForm } from "../login-form";

export const metadata = { title: "Platform administration" };

// UniAttend's own staff. There is no way to register as a platform administrator:
// the role is granted by an existing one (or the one-time setup), never claimed here.
export default async function PlatformLogin({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Platform administration</h1>
        <p className="text-sm text-muted">For UniAttend staff only. Universities, lecturers and students sign in on the main sign-in page.</p>
      </div>
      <LoginForm next={next ?? "/super"} />
      <p className="text-sm"><Link className="text-info hover:underline" href="/login">Back to sign in</Link></p>
    </div>
  );
}
