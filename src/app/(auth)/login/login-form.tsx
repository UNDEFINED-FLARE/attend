"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Captcha } from "@/components/captcha";
import { Button, Field, Input, Notice } from "@/components/ui";
import { signIn, type SignInState } from "../actions";

type PasswordCredentialCtor = new (form: HTMLFormElement) => Credential;

/**
 * The sign-in form, built so browsers and phones can save and fill the password:
 * standard field names and autocomplete hints, and, after a successful sign-in,
 * the Credential Management API where the browser has it (Chrome, Edge, Android).
 */
export function LoginForm({ next }: { next: string }) {
  const [state, run] = useActionState<SignInState, FormData>(signIn, undefined);
  const form = useRef<HTMLFormElement>(null);
  const [show, setShow] = useState(false);

  // Pages kept for offline use belong to whoever was signed in before: drop them here.
  useEffect(() => { if (typeof caches !== "undefined") void caches.delete("ua-pages-v1").catch(() => {}); }, []);

  useEffect(() => {
    if (!state?.next) return;
    void (async () => {
      try {
        const PC = (window as unknown as { PasswordCredential?: PasswordCredentialCtor }).PasswordCredential;
        if (PC && form.current) await navigator.credentials.store(new PC(form.current));
      } catch { /* saving the password is optional */ }
      // Signing in with the password counts as unlocking the app lock for this session.
      try { sessionStorage.setItem("ua_unlocked", "1"); sessionStorage.removeItem("ua_hidden_at"); } catch { /* storage blocked */ }
      // A full load, so every page sees the new session cookies straight away.
      window.location.assign(state.next!);
    })();
  }, [state]);

  return (
    <form ref={form} action={run} className="space-y-4" autoComplete="on">
      <input type="hidden" name="next" value={next} />
      <Field label="Email">
        <Input id="email" name="email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required />
      </Field>
      <Field label="Password">
        <div className="relative">
          <Input id="password" name="password" type={show ? "text" : "password"} autoComplete="current-password" required className="pr-16" />
          <button type="button" onClick={() => setShow((s) => !s)} className="absolute inset-y-0 right-2 my-auto h-8 rounded-lg px-2 text-xs font-semibold text-muted hover:text-ink" aria-pressed={show}>
            {show ? "Hide" : "Show"}
          </button>
        </div>
      </Field>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="remember" defaultChecked className="mt-0.5 size-4 accent-[var(--accent)]" />
        <span><span className="font-medium">Keep me signed in</span><span className="block text-xs text-muted">Untick on a shared or lab computer.</span></span>
      </label>
      <Captcha />
      {state?.error && <Notice tone="bad">{state.error}</Notice>}
      <SubmitButton done={!!state?.next} />
    </form>
  );
}

function SubmitButton({ done }: { done: boolean }) {
  const { pending } = useFormStatus();
  return <Button type="submit" className="w-full" disabled={pending || done} aria-busy={pending || done}>{pending || done ? "Signing in…" : "Sign in"}</Button>;
}
