import Link from "next/link";
import { Button, Notice } from "@/components/ui";
import { loadBranding } from "@/lib/branding";
import { SLUG } from "@/lib/sign-in";
import { loadDirectory } from "@/lib/sign-in-server";
import { startUniversitySignIn } from "../actions";
import { InstitutionPicker } from "./institution-picker";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  unavailable: "Institution sign-in is not available for this institution right now.",
  start: "UniAttend couldn't start your university's sign-in. Please try again in a moment.",
  link: "That sign-in link has expired or was already used. Please sign in again.",
};

/**
 * Students and lecturers start here: choose the institution, then use the way in
 * it offers — its own university account when that is approved, an email and
 * password while it is still moving across, or a clear "not yet available".
 */
export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; i?: string; change?: string; error?: string }> }) {
  const { next = "/dashboard", i, change, error } = await searchParams;
  const remembered = change ? null : (await loadBranding()).slug;
  const slug = i && SLUG.test(i) ? i : remembered;
  const [{ ok, list }, one] = await Promise.all([loadDirectory(), slug ? loadDirectory(slug) : Promise.resolve(null)]);
  const inst = one?.list[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Welcome to UniAttend</h1>
        <p className="text-sm text-muted">Your university attendance platform. Sign in securely using your institution&apos;s existing account.</p>
      </div>
      {error && ERRORS[error] && <Notice tone="bad">{ERRORS[error]}</Notice>}

      {!inst ? (
        !ok ? <Notice tone="warn">The list of institutions can&apos;t be loaded right now. Please try again in a moment.</Notice>
          : <InstitutionPicker list={list} next={next} />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3">
            {inst.logo
              // eslint-disable-next-line @next/next/no-img-element -- the institution's own logo (https, admin-set)
              ? <img src={inst.logo} alt="" className="size-10 shrink-0 rounded-xl bg-white object-contain p-1" referrerPolicy="no-referrer" />
              : <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-bg text-sm font-semibold">{(inst.short_name ?? inst.name).slice(0, 2).toUpperCase()}</span>}
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate font-medium">{inst.name}</span>
              {inst.short_name && <span className="block text-xs text-muted">{inst.short_name}</span>}
            </span>
            <Link href="/login?change=1" className="text-sm font-medium text-info hover:underline">Change</Link>
          </div>

          {inst.method === "sso" && (
            <form action={startUniversitySignIn} className="space-y-3">
              <input type="hidden" name="i" value={inst.slug} />
              <input type="hidden" name="next" value={next} />
              <Button type="submit" className="h-12 w-full text-base">Continue to institution sign-in</Button>
              <p className="text-xs text-muted">You&apos;ll sign in on {inst.name}&apos;s own page with your {inst.provider_name}, then come back here. UniAttend never sees your university password.</p>
            </form>
          )}

          {inst.method === "email" && <>
            <Notice tone="info">{inst.name} hasn&apos;t connected its university sign-in to UniAttend yet. Until it does, sign in with the email your institution has on record.</Notice>
            <LoginForm next={next} />
            <div className="flex justify-between text-sm">
              <Link className="text-info hover:underline" href={`/signup?i=${inst.slug}`}>First time? Set up access</Link>
              <Link className="text-info hover:underline" href="/forgot-password">Forgot password?</Link>
            </div>
          </>}

          {inst.method === "none" && <Notice tone="warn">Institution sign-in is not yet available. Please contact your university administrator.</Notice>}
        </div>
      )}

      <div className="border-t border-line pt-4 text-sm text-muted">
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/login/admin" className="hover:text-ink hover:underline">Institution administrator sign in</Link>
          <Link href="/login/platform" className="hover:text-ink hover:underline">Platform administration</Link>
        </p>
      </div>
    </div>
  );
}
