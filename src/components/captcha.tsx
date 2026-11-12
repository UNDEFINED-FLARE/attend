"use client";
import Script from "next/script";
import { useEffect, useRef } from "react";

// Bot protection for sign-up, sign-in and password reset (Cloudflare Turnstile,
// checked by Supabase Auth). Off until NEXT_PUBLIC_TURNSTILE_SITE_KEY is set, so
// it can be switched on without a code change:
//   1. Cloudflare → Turnstile → add the site → copy the site key and secret.
//   2. Vercel: NEXT_PUBLIC_TURNSTILE_SITE_KEY = site key; redeploy.
//   3. Supabase → Authentication → Attack protection → CAPTCHA: Turnstile + secret.
// (In that order: Supabase rejects sign-ins without a token once step 3 is on.)

export const CAPTCHA_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
export const CAPTCHA_FIELD = "cf-turnstile-response";

type Turnstile = { reset: (el?: string | HTMLElement) => void };

export function Captcha() {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const form = box.current?.closest("form");
    if (!form) return;
    // A token works once. The form's data is read when it is submitted, so a fresh
    // widget right after submit is ready for a retry if that attempt fails.
    const onSubmit = () => setTimeout(() => {
      const t = (window as unknown as { turnstile?: Turnstile }).turnstile;
      if (t && box.current) t.reset(box.current);
    }, 0);
    form.addEventListener("submit", onSubmit);
    return () => form.removeEventListener("submit", onSubmit);
  }, []);
  if (!CAPTCHA_SITE_KEY) return null;
  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" async defer />
      <div ref={box} className="cf-turnstile min-h-[65px]" data-sitekey={CAPTCHA_SITE_KEY} data-theme="auto" data-size="flexible" />
    </>
  );
}
