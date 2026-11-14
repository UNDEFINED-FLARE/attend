import Link from "next/link";
import { CompanyMark } from "@/components/company-mark";

export const metadata = { title: "Terms of service" };

// Plain-language terms for people who use UniAttend through their institution.
// The institution's own agreement with the service provider governs the service
// itself. Have a South African attorney review this before charging for the service;
// it is not legal advice.
const UPDATED = "13 November 2026";

export default function Terms() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 text-[15px] leading-relaxed">
      <Link href="/" className="text-sm text-info underline underline-offset-2 hover:decoration-2">← UniAttend</Link>
      <h1 className="mt-4 text-3xl font-semibold">Terms of service</h1>
      <p className="mt-2 text-muted">Last updated {UPDATED}. Draft for legal review.</p>

      <h2 className="mt-8 text-lg font-semibold">1. Who these terms are between</h2>
      <p className="mt-2">You use UniAttend because your university or college (your <b>institution</b>) has an agreement with
        the provider of UniAttend. These terms cover how you use it. Where your institution&apos;s rules or its agreement say
        something different, those apply.</p>

      <h2 className="mt-8 text-lg font-semibold">2. Your account</h2>
      <ul className="mt-2 list-disc space-y-2 pl-6">
        <li>Use your own account, with an email address you control, and keep your password private.</li>
        <li>Your access to an institution is given by that institution. If you are added somewhere you don&apos;t belong,
          leave it in <Link href="/settings" className="text-info underline">Security</Link> and tell us.</li>
        <li>On a shared computer, untick &ldquo;Keep me signed in&rdquo; and sign out when you finish.</li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold">3. Honest attendance</h2>
      <ul className="mt-2 list-disc space-y-2 pl-6">
        <li>Check in only for yourself, only when you are at the class.</li>
        <li>Don&apos;t check in for someone else, lend your phone or account for it, share QR codes or session codes with
          people who aren&apos;t there, or fake your location or device.</li>
        <li>Your institution decides what happens when these rules are broken, under its own disciplinary code.</li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold">4. Attendance decisions</h2>
      <p className="mt-2">UniAttend gathers evidence (the QR code, location, device and time) and records the result. Your
        lecturer and institution make the decisions, and can correct records; every correction is logged. If you think a
        record is wrong, dispute it in your attendance history. A check-in UniAttend can&apos;t confirm goes to your lecturer
        for review; it is never automatically turned into an absence.</p>

      <h2 className="mt-8 text-lg font-semibold">5. Using the service properly</h2>
      <p className="mt-2">Don&apos;t try to reach information you haven&apos;t been given access to (including other
        institutions&apos;), get around security checks, overload the service, copy it by automated means, or use it to send
        anything unlawful. If you find a security problem, please report it to us instead of testing it further.</p>

      <h2 className="mt-8 text-lg font-semibold">6. Your information</h2>
      <p className="mt-2">Your institution decides why and how your information is used (it is the <b>responsible party</b>
        under POPIA). UniAttend processes it on the institution&apos;s behalf (as its <b>operator</b>). How this works, and your
        rights, are explained in the <Link href="/privacy" className="text-info underline">privacy notice</Link>.</p>

      <h2 className="mt-8 text-lg font-semibold">7. Availability</h2>
      <p className="mt-2">We work to keep UniAttend available, but it can be interrupted by maintenance, network problems or
        events outside our control. Check-ins made without signal are saved on your phone and sent later, and lecturers can
        always correct the register by hand. Features may change; the institution&apos;s agreement sets what it is entitled to.</p>

      <h2 className="mt-8 text-lg font-semibold">8. Ending access</h2>
      <p className="mt-2">Your institution can remove your access, for example when you graduate or leave. We may suspend an
        account that breaks these terms or puts others at risk, and will tell your institution. Your institution&apos;s
        records are kept and deleted under its retention settings.</p>

      <h2 className="mt-8 text-lg font-semibold">9. Responsibility</h2>
      <p className="mt-2">As far as the law allows, UniAttend is provided as described in your institution&apos;s agreement,
        and we are not liable to you for indirect losses. Nothing in these terms limits rights you have under the Consumer
        Protection Act or other South African law that can&apos;t be limited.</p>

      <h2 className="mt-8 text-lg font-semibold">10. Changes and law</h2>
      <p className="mt-2">We will tell you in the app before important changes take effect. These terms are governed by the law
        of South Africa.</p>

      <h2 className="mt-8 text-lg font-semibold">Questions</h2>
      <p className="mt-2">Ask your institution&apos;s UniAttend administrator first; they can reach us directly.</p>
      <CompanyMark className="mt-12 border-t border-line pt-4" />
    </main>
  );
}
