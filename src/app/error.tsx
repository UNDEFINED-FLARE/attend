"use client";
import Link from "next/link";
import { useEffect } from "react";

// Shown when a page fails on the server, e.g. Supabase is unreachable.
// Production builds hide server error text, so this explains it generically.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
      <h1 className="text-[32px] font-semibold leading-none tracking-tight">This page could not load</h1>
      <p className="text-sm text-muted">
        UniAttend couldn&apos;t reach its database, or something went wrong on our side. Check your internet connection
        and try again. Your attendance records are safe.
      </p>
      <div className="flex gap-2">
        <button onClick={reset} className="h-10 rounded-lg bg-brand px-4 text-sm font-medium text-brand-ink">Try again</button>
        <Link href="/dashboard" className="inline-flex h-10 items-center rounded-lg border border-line px-4 text-sm">Go to dashboard</Link>
      </div>
      {error.digest && <p className="text-xs text-muted">Reference: {error.digest}</p>}
    </main>
  );
}
