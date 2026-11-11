import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
      <p className="text-sm font-semibold text-accent">404</p>
      <h1 className="text-[32px] font-semibold leading-none tracking-tight">Page not found</h1>
      <p className="text-sm text-muted">That page doesn&apos;t exist, or you don&apos;t have access to it.</p>
      <Link href="/dashboard" className="inline-flex h-10 w-fit items-center rounded-xl bg-brand px-4 text-sm font-medium text-brand-ink">Go to dashboard</Link>
    </main>
  );
}
