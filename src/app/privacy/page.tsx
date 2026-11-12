import Link from "next/link";

export const metadata = { title: "Privacy notice" };

// Plain-language notice drafted for POPIA. Have the institution's Information
// Officer review it before the pilot; it is not legal advice.
export default function Privacy() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 text-[15px] leading-relaxed">
      <Link href="/" className="text-sm text-info hover:underline">← UniAttend</Link>
      <h1 className="mt-4 text-3xl font-semibold">Privacy notice</h1>
      <p className="mt-2 text-muted">Draft for review by each institution&apos;s Information Officer under POPIA.</p>

      <h2 className="mt-8 text-lg font-semibold">What we collect and why</h2>
      <ul className="mt-2 list-disc space-y-2 pl-6">
        <li><b>Account details</b>: name, email, student or staff number, so your institution can record your attendance.</li>
        <li><b>Attendance records</b>: which sessions you attended, when, and the verification result.</li>
        <li><b>Location at check-in</b>: your phone&apos;s position is used once to estimate whether you are at the venue.
          We store the <i>distance</i> from the venue and the accuracy of the reading, <b>not your coordinates</b>.</li>
        <li><b>Walking directions (&ldquo;Find my class&rdquo;)</b>: your position is used on your phone to guide you. To draw the
          route, only the start and end points (no name or account) are sent through our server to OpenRouteService
          (HeiGIT, Germany). Nothing is stored. Map images are loaded from OpenStreetMap.</li>
        <li><b>Device check</b>: your browser creates a random identifier that never leaves your phone. Only a one-way hash of
          it is sent, to detect one phone being used for several students.</li>
        <li><b>Fingerprint or face unlock (optional)</b>: your phone or computer checks your fingerprint or face itself and
          only tells UniAttend &ldquo;confirmed&rdquo; or &ldquo;not confirmed&rdquo;. No fingerprint image, face scan or biometric
          template is ever sent to or stored by UniAttend. The setting stays on your device.</li>
        <li><b>Check-ins without signal</b>: the evidence above (scan, location reading, device check, time) is kept on your
          phone until it can be sent, then handled like any check-in and confirmed by your lecturer.</li>
        <li><b>Phone notifications (optional)</b>: if you turn them on, your browser&apos;s push address is stored so we can send
          class reminders and announcements. Turn them off at any time in Notifications.</li>
        <li><b>Ambient sound (optional, if your institution enables it)</b>: never recorded or uploaded. Your phone reduces a few
          seconds of sound to numeric fingerprints, which are deleted as soon as they have been compared.</li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold">Fairness</h2>
      <p className="mt-2">Location, device and sound signals are imperfect. When they are inconclusive your check-in goes to your
        lecturer for review; it is never automatically turned into an absence. You can dispute any absence or late mark.</p>

      <h2 className="mt-8 text-lg font-semibold">Who can see it</h2>
      <p className="mt-2">You; the lecturers of modules you are enrolled in; your institution&apos;s administrators. No other
        institution can access your data. UniAttend staff access it only to provide support.</p>

      <h2 className="mt-8 text-lg font-semibold">Retention and your rights</h2>
      <p className="mt-2">Records are kept for the period your institution sets (three years by default), then deleted. You may
        ask your institution to access, correct or delete your information, or object to processing, and you may complain to
        the Information Regulator.</p>
    </main>
  );
}
