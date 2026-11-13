import Link from "next/link";
import { CompanyMark } from "@/components/company-mark";
import { LinkButton } from "@/components/ui";

const LAYERS = [
  ["Live QR", "A signed code that changes every 20 seconds. A forwarded screenshot is stale before it arrives."],
  ["Location", "Checked against the mapped venue, weighted by the phone's own accuracy. Never treated as proof on its own."],
  ["Device", "A privacy-preserving hash flags one phone checking in several students, without blocking someone who changed phones."],
  ["Fair review", "Weak signals send a check-in to the lecturer for review. They never silently become an absence."],
];

export default function Home() {
  return (
    <div className="min-h-dvh">
      <header className="bg-brand text-brand-ink">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 h-16">
          <span className="text-lg font-semibold">UniAttend</span>
          <nav className="flex gap-2">
            <Link href="/login" className="rounded-md px-3 py-2 text-sm hover:bg-white/10">Sign in</Link>
            <Link href="/signup" className="rounded-md bg-white px-3 py-2 text-sm font-medium text-brand">Create account</Link>
          </nav>
        </div>
        <div className="mx-auto max-w-6xl px-4 pb-20 pt-12">
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight sm:text-5xl">
            Verified lecture attendance for South African universities.
          </h1>
          <p className="mt-4 max-w-2xl text-lg opacity-85">
            One platform for every faculty: lecturers open a session in seconds, students check in with one scan,
            and administrators get registers they can defend.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className="rounded-lg bg-white px-5 py-3 font-medium text-brand">Get started</Link>
            <Link href="/onboarding" className="rounded-lg border border-white/30 px-5 py-3 font-medium">Register an institution</Link>
          </div>
        </div>
      </header>
      <main className="mx-auto grid max-w-6xl gap-4 px-4 py-14 sm:grid-cols-2 lg:grid-cols-4">
        {LAYERS.map(([t, d]) => (
          <div key={t} className="rounded-xl border border-line bg-surface p-5">
            <h2 className="font-semibold">{t}</h2>
            <p className="mt-2 text-sm text-muted">{d}</p>
          </div>
        ))}
      </main>
      <footer className="mx-auto max-w-6xl px-4 pb-10 text-sm text-muted">
        <Link href="/privacy" className="hover:underline">Privacy notice</Link>
        <span className="mx-2">·</span>
        <Link href="/terms" className="hover:underline">Terms of service</Link>
        <span className="mx-2">·</span>
        <Link href="/paia" className="hover:underline">PAIA manual</Link>
        <span className="mx-2">·</span>
        <LinkButton href="/login" variant="ghost" className="h-auto px-0">Sign in</LinkButton>
        <CompanyMark className="mt-3" />
      </footer>
    </div>
  );
}
