import Link from "next/link";
import { Icon, type IconName } from "@/components/icons";
import { LinkButton } from "@/components/ui";
import { moduleColor, moduleColorOnDark } from "@/components/week-grid";

// The public front page, in the "campus signage" look: the memorable piece is a venue board
// like the ones outside lecture halls, showing a morning's classes and their live check-ins.

const BOARD: { code: string; venue: string; time: string; state: "done" | "open" | "later"; note: string }[] = [
  { code: "CSC111", venue: "Lecture Hall A", time: "08:00", state: "done", note: "198 of 210 in" },
  { code: "PHY101", venue: "Science Block S101", time: "10:00", state: "open", note: "164 checked in" },
  { code: "ENG101", venue: "Humanities Hall H2", time: "13:00", state: "later", note: "Opens 13:00" },
  { code: "MAT101", venue: "Library Seminar Room", time: "15:00", state: "later", note: "Opens 15:00" },
];

const CHECKS: [IconName, string, string][] = [
  ["qr", "Live QR", "A signed code that changes every 20 seconds. A forwarded screenshot is stale before it arrives."],
  ["pin", "Location", "Checked against the mapped venue, weighted by the phone's own accuracy. Never treated as proof on its own."],
  ["shield", "Device", "A privacy-preserving hash flags one phone checking in several students, without blocking someone who changed phones."],
  ["userCheck", "Fair review", "Weak signals send a check-in to the lecturer for review. They never silently become an absence."],
];

const PEOPLE: [string, string][] = [
  ["Students", "Scan the code on the projector and you're in. If your phone lets you down, the check-in goes to your lecturer, not straight to absent."],
  ["Lecturers", "Open attendance from your phone, see who is in the room, and correct the register afterwards with a reason on record."],
  ["Administrators", "Bring in timetables and class lists from the files you already have, follow up students who stop coming, and keep registers you can defend."],
];

export default function Home() {
  return (
    <div className="min-h-dvh bg-bg">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl bg-brand text-signal"><Icon name="check" size={20} strokeWidth={3} /></span>
            <span className="font-display text-xl font-bold">UniAttend</span>
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2">
            <Link href="/login" className="rounded-xl px-3 py-2 text-sm font-semibold hover:bg-bg">Sign in</Link>
            <LinkButton href="/signup" className="h-10">Create account</LinkButton>
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-12 sm:py-16 lg:grid-cols-[1fr_1.05fr]">
          <div>
            <h1 className="max-w-xl text-[44px] font-bold leading-[0.95] tracking-tight sm:text-[60px]">
              Verified lecture attendance for South African universities.
            </h1>
            <p className="mt-5 max-w-lg text-lg text-muted">
              Lecturers open a session in seconds, students check in with one scan, and administrators get registers they can defend.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <LinkButton href="/signup" className="h-12 px-6 text-base">Create an account</LinkButton>
              <LinkButton href="/onboarding" variant="secondary" className="h-12 px-6 text-base">Register your university</LinkButton>
            </div>
          </div>
          <VenueBoard />
        </section>

        <section aria-labelledby="checks" className="border-y border-line bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-14">
            <h2 id="checks" className="text-[32px] font-bold leading-tight">How a check-in is verified</h2>
            <p className="mt-2 max-w-2xl text-muted">Four signals are weighed together. None of them decides on its own, so an honest student with a weak signal is never marked absent by a machine.</p>
            <ul className="mt-8 grid gap-px overflow-hidden rounded-2xl bg-line shadow-card sm:grid-cols-2">
              {CHECKS.map(([icon, title, text]) => (
                <li key={title} className="flex gap-4 bg-surface p-5">
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand text-brand-ink"><Icon name={icon} size={22} /></span>
                  <div>
                    <h3 className="text-xl font-bold">{title}</h3>
                    <p className="mt-1 text-sm text-muted">{text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="people" className="mx-auto max-w-6xl px-4 py-14">
          <h2 id="people" className="text-[32px] font-bold leading-tight">One place for everyone on campus</h2>
          <div className="mt-8 grid gap-8 md:grid-cols-3">
            {PEOPLE.map(([who, text], i) => (
              <div key={who} className="border-t-4 pt-4" style={{ borderColor: moduleColor(["CSC111", "PHY101", "MAT101"][i]) }}>
                <h3 className="text-2xl font-bold">{who}</h3>
                <p className="mt-2 text-muted">{text}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted">
          <span>UniAttend. Built for POPIA: we store a distance from the venue, never your location history.</span>
          <nav className="flex gap-4">
            <Link href="/privacy" className="font-medium hover:text-ink hover:underline">Privacy notice</Link>
            <Link href="/login" className="font-medium hover:text-ink hover:underline">Sign in</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/** A venue board, as outside a lecture hall: today's classes with their check-in status. */
function VenueBoard() {
  return (
    <figure className="overflow-hidden rounded-2xl bg-brand text-brand-ink shadow-float">
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <p className="font-display text-2xl font-bold">Today&apos;s lectures</p>
        <p className="font-display text-lg font-semibold tabular-nums opacity-80">10:24</p>
      </div>
      <ul className="divide-y divide-white/15 border-t border-white/15">
        {BOARD.map((r) => (
          <li key={r.code} className={`flex items-center gap-3 px-5 py-3.5 ${r.state === "done" ? "opacity-60" : ""}`}>
            <span className="h-10 w-1.5 shrink-0 rounded-full" style={{ background: moduleColorOnDark(r.code) }} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-display text-xl font-bold leading-tight">{r.code}</p>
              <p className="truncate text-sm opacity-85">{r.venue}</p>
            </div>
            <p className="hidden font-display text-lg font-semibold tabular-nums sm:block">{r.time}</p>
            <span className={`shrink-0 truncate rounded-md px-2.5 py-1 text-center text-sm font-semibold sm:w-36 ${
              r.state === "open" ? "bg-signal text-signal-ink" : r.state === "done" ? "bg-white/10" : "bg-white/5 opacity-85"}`}>
              {r.state === "done" && <Icon name="check" size={14} strokeWidth={3} className="mr-1 inline" />}{r.note}
            </span>
          </li>
        ))}
      </ul>
      <figcaption className="px-5 py-3 text-xs opacity-70">An example of what lecturers and administrators see on a normal morning.</figcaption>
    </figure>
  );
}
