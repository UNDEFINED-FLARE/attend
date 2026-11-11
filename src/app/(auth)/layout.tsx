import Link from "next/link";
import { Icon } from "@/components/icons";

// Sign in, sign up and password pages: the form on white, with a navy sign panel beside it
// on wide screens and a slim navy band above it on phones.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-surface lg:grid-cols-[1fr_1.1fr]">
      <aside className="flex items-center justify-between bg-brand px-4 py-3 text-brand-ink lg:flex-col lg:items-stretch lg:p-10">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-white/10 text-signal"><Icon name="check" size={20} strokeWidth={3} /></span>
          <span className="font-display text-xl font-bold">UniAttend</span>
        </Link>
        <div className="hidden max-w-md lg:block">
          <p className="font-display text-[44px] font-bold leading-[0.95] tracking-tight">Attendance you can stand behind.</p>
          <p className="mt-4 text-lg opacity-85">Live QR codes, location and device checks, and a review process that never turns a flat battery into an absence.</p>
          <div className="mt-8 flex items-center gap-3 rounded-xl bg-white/10 p-4">
            <span className="rounded-md bg-signal px-2.5 py-1 font-display text-base font-bold text-signal-ink">Attendance open</span>
            <span className="min-w-0">
              <span className="block font-display text-xl font-bold leading-tight">CSC111</span>
              <span className="block truncate text-sm opacity-85">Lecture Hall A, on time until 08:15</span>
            </span>
          </div>
        </div>
        <p className="hidden text-sm opacity-70 lg:block">Built for POPIA: a distance from the venue is stored, never a location history.</p>
      </aside>
      <main className="flex items-start justify-center px-4 py-10 sm:items-center sm:p-10">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
