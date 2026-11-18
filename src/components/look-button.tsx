"use client";
import { useRouter } from "next/navigation";
import { useTransition, type ReactNode } from "react";
import { LOOK_COOKIE, type Look } from "@/lib/look";

/** Switches this device to another look (lib/look.ts) and redraws the page in it. */
export function LookButton({ to, className, children }: { to: Look; className?: string; children: ReactNode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} aria-busy={pending || undefined} className={className}
      onClick={() => {
        // A year, on this device only; the server reads it to draw the chosen look first time.
        document.cookie = `${LOOK_COOKIE}=${to}; path=/; max-age=31536000; samesite=lax`;
        start(() => router.refresh());
      }}>
      {children}
    </button>
  );
}
