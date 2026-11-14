import Link from "next/link";
import { CompanyMark } from "@/components/company-mark";
import { Icon, type IconName } from "@/components/icons";
import { LinkButton } from "@/components/ui";

// The public front page. Modelled on how attendance products present themselves (Edusign,
// Top Hat, iClicker): show the real app rather than an illustration, explain the steps in
// order, and keep the colours to the theme so Graphite, Navy and dark designs all apply.

const STEPS: [string, string][] = [
  ["The lecturer opens attendance", "One tap at the start of the class puts a QR code on the projector. It changes every 20 seconds."],
  ["Students check in", "They scan the code with UniAttend. Their phone’s location and the code are checked together."],
  ["The register is ready", "Clear check-ins are recorded at once. Anything doubtful goes to the lecturer to decide, never straight to absent."],
];

const CHECKS: [IconName, string, string][] = [
  ["qr", "Live QR", "A signed code that changes every 20 seconds, so a forwarded screenshot is stale before it arrives."],
  ["pin", "Location", "Checked against the mapped venue and weighted by the phone’s own accuracy. Never treated as proof on its own."],
  ["shield", "Device", "A privacy-preserving hash flags one phone checking in several students, without blocking someone who changed phones."],
  ["userCheck", "Fair review", "Weak signals send a check-in to the lecturer for review. They never silently become an absence."],
];

const REGISTER: [string, string, "Present" | "Late" | "In review"][] = [
  ["AZ", "Ayanda Zulu", "Present"], ["KM", "Kagiso Molefe", "Present"], ["LN", "Lindiwe Nkosi", "Late"],
  ["TM", "Tshepo Mahlangu", "In review"], ["PB", "Pieter Botha", "Present"],
];

export default function Home() {
  return (
    <div className="min-h-dvh bg-bg">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 text-lg font-semibold">
            <span className="grid size-8 place-items-center rounded-lg bg-brand text-brand-ink"><Icon name="check" size={18} strokeWidth={2.6} /></span>
            UniAttend
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2">
            <Link href="/login" className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-bg">Sign in</Link>
            <LinkButton href="/signup" className="h-10">Create account</LinkButton>
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-14 lg:grid-cols-[1.15fr_1fr] lg:py-20">
          <div>
            <h1 className="max-w-xl text-balance text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
              Verified lecture attendance for South African universities.
            </h1>
            <p className="mt-5 max-w-lg text-lg text-muted">
              One platform for every faculty: lecturers open a session in seconds, students check in with one scan,
              and administrators get registers they can defend.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <LinkButton href="/signup" className="h-12 px-6 text-base">Create an account</LinkButton>
              <LinkButton href="/onboarding" variant="secondary" className="h-12 px-6 text-base">Register your university</LinkButton>
            </div>
          </div>
          <PhoneShot />
        </section>

        <section aria-labelledby="steps" className="border-y border-line bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-14">
            <h2 id="steps" className="text-balance text-2xl font-semibold sm:text-3xl">How it works</h2>
            <ol className="mt-8 grid gap-8 md:grid-cols-3">
              {STEPS.map(([title, text], i) => (
                <li key={title}>
                  <span className="grid size-8 place-items-center rounded-full border border-line-strong text-sm font-semibold tabular-nums">{i + 1}</span>
                  <h3 className="mt-3 text-lg font-semibold">{title}</h3>
                  <p className="mt-1 text-muted">{text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="checks" className="mx-auto max-w-6xl px-4 py-14">
          <h2 id="checks" className="text-balance text-2xl font-semibold sm:text-3xl">4 checks, weighed together</h2>
          <p className="mt-2 max-w-2xl text-muted">None of them decides on its own, so an honest student with a weak signal is never marked absent by a machine.</p>
          <dl className="mt-8 grid gap-x-12 gap-y-8 sm:grid-cols-2">
            {CHECKS.map(([icon, title, text]) => (
              <div key={title} className="flex gap-4">
                <Icon name={icon} size={26} strokeWidth={1.5} className="mt-0.5 shrink-0 text-muted" />
                <div>
                  <dt className="text-lg font-semibold">{title}</dt>
                  <dd className="mt-1 text-muted">{text}</dd>
                </div>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="register" className="border-t border-line bg-surface">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 lg:grid-cols-2">
            <div>
              <h2 id="register" className="text-balance text-2xl font-semibold sm:text-3xl">The register is done when the class ends</h2>
              <p className="mt-3 max-w-lg text-muted">
                Lecturers see who is in the room as they arrive, decide on late arrivals and doubtful check-ins in a tap,
                and correct a mark later with the reason kept on record. Administrators follow up students who stop coming.
              </p>
              <LinkButton href="/onboarding" variant="secondary" className="mt-6">Register your university</LinkButton>
            </div>
            <RegisterShot />
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-muted">
          <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/privacy" className="underline underline-offset-2 hover:text-ink">Privacy notice</Link>
            <Link href="/terms" className="underline underline-offset-2 hover:text-ink">Terms of service</Link>
            <Link href="/paia" className="underline underline-offset-2 hover:text-ink">PAIA manual</Link>
            <Link href="/login" className="underline underline-offset-2 hover:text-ink">Sign in</Link>
          </nav>
          <CompanyMark className="mt-4" />
        </div>
      </footer>
    </div>
  );
}

/** The student app on a phone, as it looks when a lecturer has opened attendance. */
function PhoneShot() {
  return (
    <figure className="mx-auto w-full max-w-[300px]">
      <div aria-hidden className="rounded-[2.5rem] border-[10px] border-ink bg-bg p-4 pb-0 shadow-card">
        <div className="flex justify-between px-1 text-[11px] font-semibold tabular-nums"><span>08:04</span><span>100%</span></div>
        <p className="mt-4 text-xs text-muted">Good morning, Thabo</p>
        <p className="text-xl font-bold">Home</p>
        <div className="mt-3 overflow-hidden rounded-2xl bg-surface shadow-card">
          <div className="h-1.5 bg-brand" />
          <div className="p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-ok"><span className="size-1.5 rounded-full bg-ok" />Attendance is open</p>
            <p className="mt-2 text-[11px] font-semibold text-muted">CSC111</p>
            <p className="text-sm font-semibold leading-snug">Introduction to Programming</p>
            <p className="mt-1 text-[11px] text-muted">Computer Lab C3, on time until 08:15</p>
            <p className="mt-3 rounded-lg bg-brand py-2 text-center text-xs font-semibold text-brand-ink">Check in</p>
          </div>
        </div>
        <p className="mt-4 text-xs font-semibold">Today’s classes</p>
        <div className="mt-2 divide-y divide-line rounded-t-2xl bg-surface shadow-card">
          {[["08:00", "Introduction to Programming", "Computer Lab C3"], ["10:00", "Calculus I", "Lecture Hall A"], ["14:00", "Physics for Scientists", "Science Block S101"]].map(([t, c, v]) => (
            <div key={t} className="flex items-center gap-2 px-3 py-2">
              <span className="w-9 text-[11px] font-semibold tabular-nums">{t}</span>
              <span className="h-6 w-0.5 rounded-full bg-muted" />
              <span className="min-w-0"><span className="block truncate text-[11px] font-medium">{c}</span><span className="block truncate text-[10px] text-muted">{v}</span></span>
            </div>
          ))}
        </div>
      </div>
      <figcaption className="mt-3 text-center text-sm text-muted">The student app when a lecturer has opened attendance.</figcaption>
    </figure>
  );
}

/** A lecturer's live register, as in the app. */
function RegisterShot() {
  const tone = { Present: "bg-ok/10 text-ok", Late: "bg-warn/10 text-warn", "In review": "bg-info/10 text-info" } as const;
  return (
    <figure className="overflow-hidden rounded-2xl bg-bg shadow-card">
      <div aria-hidden>
        <div className="flex items-center justify-between border-b border-line bg-surface px-4 py-3">
          <div>
            <p className="font-semibold">CSC111 lecture</p>
            <p className="text-xs text-muted">Computer Lab C3, open until 08:50</p>
          </div>
          <p className="text-right text-sm"><span className="font-semibold tabular-nums">164</span> <span className="text-muted">of 210 in</span></p>
        </div>
        <ul className="divide-y divide-line bg-surface">
          {REGISTER.map(([initials, name, status]) => (
            <li key={name} className="flex items-center gap-3 px-4 py-2.5">
              <span className="grid size-8 place-items-center rounded-full bg-bg text-xs font-semibold">{initials}</span>
              <span className="flex-1 text-sm">{name}</span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tone[status]}`}>{status}</span>
            </li>
          ))}
        </ul>
      </div>
      <figcaption className="px-4 py-2.5 text-xs text-muted">A lecturer’s register during a class (example names).</figcaption>
    </figure>
  );
}
