import Link from "next/link";
import { CompanyMark } from "@/components/company-mark";
import { LEGAL, show } from "@/lib/legal";

export const metadata = { title: "Delete your account" };

// Public (no sign-in) page Google Play asks for: how to ask for a UniAttend account and its
// data to be deleted, from the app or without it, and what is deleted or kept. It describes the
// request flow that already exists (Security → Ask about my information → Delete my information,
// handled by the institution's admins and UniAttend with a 30-day clock; see data_requests).
const H2 = ({ children }: { children: React.ReactNode }) => <h2 className="mt-10 text-lg font-semibold">{children}</h2>;

export default function DeleteAccount() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 text-[15px] leading-relaxed">
      <Link href="/" className="text-sm text-info hover:underline">← UniAttend</Link>
      <h1 className="mt-4 text-3xl font-semibold">Delete your UniAttend account</h1>
      <p className="mt-4">You can ask for your UniAttend account, and the personal information linked to it, to be deleted at any
        time. UniAttend is run by {show(LEGAL.company)} for your university or college.</p>

      <H2>Ask in the app</H2>
      <ol className="mt-2 list-decimal space-y-2 pl-6">
        <li>Sign in to UniAttend, in the app or at this website.</li>
        <li>Open <b>Security &amp; app lock</b>: tap your initials at the top of the screen, or the lock icon on a computer.</li>
        <li>In <b>Your data</b>, open <b>Ask about my information</b>, choose <b>Delete my information</b>, add a short note if
          you like, and send it.</li>
        <li>You can follow the request on the same page. It is answered within 30 days.</li>
      </ol>

      <H2>Can&apos;t sign in?</H2>
      <p className="mt-2">Ask your institution&apos;s faculty office or IT support, which manages your UniAttend account, or email
        UniAttend at <b>{show(LEGAL.privacyEmail)}</b>. Write from the email address on your account and include your name, your
        institution and your student or staff number, so we can find the right account.</p>

      <H2>What is deleted</H2>
      <ul className="mt-2 list-disc space-y-1 pl-6">
        <li>Your sign-in account: email address and password.</li>
        <li>Your name and contact details in UniAttend.</li>
        <li>The device check value linked to your check-ins (a scrambled code, not your phone&apos;s identity).</li>
        <li>Your notification addresses and your app settings.</li>
      </ul>

      <H2>What may be kept, and for how long</H2>
      <ul className="mt-2 list-disc space-y-2 pl-6">
        <li><b>Attendance records</b> your institution must keep as part of its academic records. It decides this, as the
          responsible party under POPIA. They are kept for its retention period (three years by default) and then deleted.</li>
        <li>A note in the audit log that the request was received and handled, so the institution can show it acted on it.</li>
      </ul>
      <p className="mt-3">Information stored on your phone (the app lock setting and check-ins waiting for signal) is removed when you
        uninstall the app or clear its storage.</p>

      <p className="mt-10 text-sm text-muted">More detail is in the <Link href="/privacy" className="text-info underline">privacy notice</Link>.</p>
      <CompanyMark className="mt-12 border-t border-line pt-4" />
    </main>
  );
}
