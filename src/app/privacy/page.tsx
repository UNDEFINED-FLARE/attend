import Link from "next/link";
import { LEGAL, show, SUB_OPERATORS } from "@/lib/legal";

export const metadata = { title: "Privacy notice" };

// Written to cover what POPIA section 18 says people must be told. Each
// institution's Information Officer, and an attorney, should review it before
// launch; it is not legal advice. Company details come from src/lib/legal.ts.
const H2 = ({ id, children }: { id?: string; children: React.ReactNode }) => <h2 id={id} className="mt-10 scroll-mt-6 text-lg font-semibold">{children}</h2>;

export default function Privacy() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 text-[15px] leading-relaxed">
      <Link href="/" className="text-sm text-info hover:underline">← UniAttend</Link>
      <h1 className="mt-4 text-3xl font-semibold">Privacy notice</h1>
      <p className="mt-2 text-muted">Last updated {LEGAL.privacyUpdated}. Draft for review by each institution&apos;s Information Officer.</p>

      <p className="mt-6">UniAttend records class attendance for universities and colleges. This notice explains what we collect about you,
        why, who sees it, how long it is kept and what you can do about it, as the Protection of Personal Information Act (POPIA)
        requires. In short: <b>we collect what is needed to record your attendance fairly, we don&apos;t sell it or use it for
        advertising, and you can see all of it at any time</b> (Security → Download my data).</p>

      <H2>1. Who is responsible</H2>
      <ul className="mt-2 list-disc space-y-2 pl-6">
        <li><b>Your institution</b> is the <i>responsible party</i>: it decides why your attendance is recorded and what happens
          with it. Its own privacy policy also applies.</li>
        <li><b>{show(LEGAL.company)}</b> runs UniAttend as the institution&apos;s <i>operator</i>, processing your information only
          on its instructions, under a written agreement.</li>
        <li>Our Information Officer: {show(LEGAL.informationOfficer)}, {show(LEGAL.privacyEmail)}. Address: {show(LEGAL.address)}.</li>
      </ul>

      <H2>2. What we collect and why</H2>
      <ul className="mt-2 list-disc space-y-2 pl-6">
        <li><b>Account details</b>: your name and email, and your student or staff number, so your institution can record
          your attendance and you can sign in.</li>
        <li><b>Your modules, timetable and attendance records</b>: which classes you attended, when, late or early departures,
          and the result of each check-in, so attendance can be recorded and reported.</li>
        <li><b>Check-in evidence</b>:
          <ul className="mt-1 list-[circle] space-y-1 pl-6">
            <li><i>QR code or session code</i>: whether it was valid at that moment.</li>
            <li><i>Location</i>: your phone&apos;s position is used once to estimate whether you are at the venue. We keep the
              <b> distance</b> from the venue and the accuracy, <b>not your coordinates</b>, and never track you afterwards.</li>
            <li><i>Device check</i>: a one-way hash of a random identifier your browser creates, to notice one phone being used to
              check in several students. It can&apos;t identify your phone or you.</li>
          </ul></li>
        <li><b>Disputes and corrections</b>: what you or your lecturer change, and why, so every change can be traced.</li>
        <li><b>Early-warning alerts</b>, if your institution uses them: when your attendance in a module falls below its
          minimum, so staff can offer support.</li>
        <li><b>Optional, only if you choose</b>:
          <ul className="mt-1 list-[circle] space-y-1 pl-6">
            <li><i>Phone notifications</i>: a push address for your browser or phone.</li>
            <li><i>Fingerprint or face unlock</i>: your device checks it and tells UniAttend only &ldquo;confirmed&rdquo; or
              &ldquo;not confirmed&rdquo;. <b>No fingerprint, face scan or biometric template ever reaches UniAttend.</b></li>
            <li><i>Walking directions</i>: the start and end of the route (no name or account) go to the route service.</li>
          </ul></li>
        <li><b>Ambient sound</b>, only if your institution enables it: never recorded or uploaded; your phone reduces a few
          seconds of sound to numeric fingerprints, deleted once compared.</li>
        <li><b>Technical records</b>: sign-in times and short-lived server logs, to keep the service secure.</li>
      </ul>
      <p className="mt-3">Most of this comes from your institution (your name, number, email and modules) or from your own
        check-ins. We do not collect ID numbers, health information, photos or biometric data.</p>

      <H2>3. Do you have to provide it?</H2>
      <p className="mt-2">Your institution decides whether attendance is required. If you don&apos;t check in, or don&apos;t share
        your location where it is checked, your attendance may not be recorded automatically. Your lecturer can always record
        it by hand. The optional features above are entirely up to you.</p>

      <H2>4. Why this is allowed</H2>
      <p className="mt-2">Your institution processes your information to run its academic programmes and meet its obligations
        (POPIA section 11(1)(b), (c) and (f)). Optional features rely on your choice to turn them on, which you can reverse at
        any time.</p>

      <H2>5. Automated checks and fairness</H2>
      <p className="mt-2">A check-in is scored automatically from the evidence above. A strong check-in is recorded straight
        away; <b>a weak or unclear one is never turned into an absence automatically</b>: it goes to your lecturer to decide.
        Early-warning alerts only flag a pattern for staff to follow up; they don&apos;t make decisions about you. You can
        always see the explanation for a record in your history, and dispute any absence or late mark (POPIA section 71).</p>

      <H2>6. Who can see it</H2>
      <ul className="mt-2 list-disc space-y-2 pl-6">
        <li>You.</li>
        <li>The lecturers of modules you are enrolled in, and your institution&apos;s administrators.</li>
        <li><b>No other institution</b>, even one using UniAttend: each institution&apos;s records are kept apart by the
          database itself.</li>
        <li>UniAttend support staff, only to provide support, under confidentiality.</li>
        <li>The service providers below, only for the stated purpose.</li>
      </ul>

      <H2 id="sub-operators">7. Service providers we use</H2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-left text-sm">
          <thead className="text-xs uppercase text-muted"><tr><th className="py-2 pr-3">Provider</th><th className="py-2 pr-3">What for</th><th className="py-2 pr-3">Where</th><th className="py-2">What they get</th></tr></thead>
          <tbody>{SUB_OPERATORS.map((s) => (
            <tr key={s.name} className="border-t border-line align-top"><td className="py-2 pr-3 font-medium">{s.name}</td><td className="py-2 pr-3">{s.purpose}</td><td className="py-2 pr-3">{s.where}</td><td className="py-2">{s.data}</td></tr>
          ))}</tbody>
        </table>
      </div>

      <H2>8. Information stored outside South Africa</H2>
      <p className="mt-2">Your records are stored in {LEGAL.hostingRegion}. The European Union&apos;s data-protection law (the GDPR)
        gives protection substantially similar to POPIA, and our providers are bound by written terms to protect it
        (POPIA section 72).</p>

      <H2>9. How long it is kept</H2>
      <p className="mt-2">Your institution sets the period (three years by default). After that, records are deleted. Your
        institution can do this itself, or have it done automatically every night. If you leave, your institution removes your
        access; your records stay until that period ends, then go. Notifications and logs follow the same period.</p>

      <H2>10. How it is protected</H2>
      <p className="mt-2">Encrypted connections; each institution&apos;s records separated in the database; access only by role;
        rotating, signed QR codes; a log of administrative changes and corrections; optional fingerprint/face lock and bot
        protection on sign-in. If a breach ever affects your information, your institution and the Information Regulator will be
        told, and so will you where required (POPIA section 22).</p>

      <H2>11. Your rights</H2>
      <ul className="mt-2 list-disc space-y-2 pl-6">
        <li><b>See your information</b>: Security → <i>Download my data</i>, at any time, free.</li>
        <li><b>Correct or delete it, or object</b> to how it is used: Security → <i>Ask about my information</i>. Your institution
          answers (it decides about its records), within 30 days.</li>
        <li><b>Dispute an attendance record</b>: from your attendance history.</li>
        <li><b>Leave an institution</b> you were added to by mistake: Security → Your institutions.</li>
        <li><b>Complain</b> to the Information Regulator if you are unhappy with the answer:{" "}
          <a href="https://inforegulator.org.za" className="text-info underline" rel="noopener noreferrer">inforegulator.org.za</a>.</li>
      </ul>

      <H2>12. Students under 18</H2>
      <p className="mt-2">Some first-year students are under 18. Your institution is responsible for having the authority it needs
        to record their attendance, as it does for its other records.</p>

      <H2>13. Cookies and storage on your device</H2>
      <p className="mt-2">UniAttend uses only what it needs to work; <b>no advertising or tracking cookies</b>.</p>
      <ul className="mt-2 list-disc space-y-1 pl-6 text-sm">
        <li><code>sb-…-auth-token</code>: keeps you signed in (up to 400 days, or until you close the browser if you untick &ldquo;Keep me signed in&rdquo;).</li>
        <li><code>ua_inst</code>, <code>ua_brand</code>, <code>ua_session_only</code>: which institution you are using, its look on the sign-in page, and your sign-in choice.</li>
        <li>On your device only: your app-lock setting, check-ins saved without signal until they are sent, and recently opened pages for offline use (cleared when the sign-in page opens).</li>
      </ul>

      <H2>14. Changes</H2>
      <p className="mt-2">We will tell you in the app before an important change to this notice. Earlier versions are available on request.</p>

      <p className="mt-10 text-sm text-muted">See also the <Link href="/terms" className="text-info underline">terms of service</Link> and our{" "}
        <Link href="/paia" className="text-info underline">PAIA manual</Link>.</p>
    </main>
  );
}
