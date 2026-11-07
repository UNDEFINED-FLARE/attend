import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <aside className="hidden flex-col justify-between bg-brand p-10 text-brand-ink lg:flex">
        <Link href="/" className="text-lg font-semibold">UniAttend</Link>
        <div className="max-w-md space-y-4">
          <p className="text-3xl font-semibold leading-tight">Attendance you can stand behind.</p>
          <p className="opacity-80">Live QR codes, location and device checks, and a review process that never turns
            a flat battery into an absence.</p>
        </div>
        <p className="text-sm opacity-60">POPIA-conscious by design.</p>
      </aside>
      <main className="flex items-center justify-center p-4 sm:p-10">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
