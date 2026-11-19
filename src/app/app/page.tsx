import { readFileSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import { CompanyMark } from "@/components/company-mark";
import { Icon } from "@/components/icons";
import { formatBytes, parseRelease } from "@/lib/app-release";
import { DownloadQr } from "./download-qr";
import { BrandMark } from "@/components/brand-mark";

export const metadata = {
  title: "Get the app",
  description: "Download the UniAttend Android app, or install UniAttend from your browser.",
};

// Read at build time: publishing a new APK (npm run android:publish) needs a deploy anyway.
function release() {
  try { return parseRelease(JSON.parse(readFileSync(join(process.cwd(), "public/downloads/android.json"), "utf8"))); }
  catch { return null; }
}

const Step = ({ n, children }: { n: number; children: React.ReactNode }) => (
  <li className="flex gap-3">
    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-brand-ink">{n}</span>
    <span className="pt-0.5">{children}</span>
  </li>
);

export default function GetTheApp() {
  const apk = release();
  const published = apk?.publishedAt ? new Date(apk.publishedAt).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Johannesburg" }) : null;

  return (
    <div className="min-h-dvh bg-bg">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 text-lg font-semibold">
            <BrandMark className="size-8" rounded="rounded-lg" />
            UniAttend
          </Link>
          <Link href="/login" className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-bg">Sign in</Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-4 py-10 text-[15px] leading-relaxed">
        <div>
          <h1 className="text-3xl font-semibold">Get the UniAttend app</h1>
          <p className="mt-2 max-w-2xl text-muted">Check in to class, see your timetable and find your venue. After you&apos;ve signed in once with
            signal, your timetable, classes, modules, venues and recent attendance open without an internet connection, and you
            can open the app with your fingerprint, face or phone PIN.</p>
        </div>

        {/* Android */}
        <section aria-labelledby="android" className="rounded-3xl bg-surface p-6 shadow-card">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0 flex-1">
              <h2 id="android" className="text-xl font-semibold">Android phones</h2>
              {apk ? (
                <>
                  <p className="mt-1 text-sm text-muted">
                    Version {apk.version} · {formatBytes(apk.bytes)} · Android {apk.minAndroid} or newer{published ? ` · published ${published}` : ""}
                  </p>
                  {apk.build === "test" && (
                    <p className="mt-3 rounded-xl bg-warn/10 px-3 py-2 text-sm text-warn">
                      This is a test build. A later release build can&apos;t install over it: uninstall it first when the release arrives.
                    </p>
                  )}
                  <a href={apk.url} download={apk.file} rel="nofollow"
                    className="mt-4 inline-flex h-12 items-center gap-2 rounded-2xl bg-brand px-6 text-base font-semibold text-brand-ink">
                    <Icon name="download" size={20} /> Download for Android
                  </a>
                  <dl className="mt-4 text-xs">
                    <dt className="font-semibold">SHA-256 checksum</dt>
                    <dd className="mt-1 break-all font-mono text-muted">{apk.sha256}</dd>
                  </dl>
                </>
              ) : (
                <p className="mt-2 text-sm text-muted">The Android download isn&apos;t available yet. In the meantime, install UniAttend from your
                  browser (below): it works the same way.</p>
              )}
            </div>
            {apk && <DownloadQr href={apk.url} />}
          </div>

          {apk && (
            <div className="mt-6 grid gap-6 border-t border-line pt-6 md:grid-cols-2">
              <div>
                <h3 className="font-semibold">Install it</h3>
                <ol className="mt-3 space-y-3 text-sm">
                  <Step n={1}>On your phone, tap <b>Download for Android</b> (or scan the code from a computer).</Step>
                  <Step n={2}>Open the downloaded file from the notification or your <b>Downloads</b>.</Step>
                  <Step n={3}>If Android asks, allow <b>Install unknown apps</b> for your browser. You only do this once.</Step>
                  <Step n={4}>Tap <b>Install</b>, then <b>Open</b>. If Play Protect warns that it doesn&apos;t know the app, it&apos;s because the
                    app comes from this website rather than Google Play: check the checksum (below) if you want to be sure, then choose to install anyway.</Step>
                  <Step n={5}>Sign in with your university account while you have signal.</Step>
                  <Step n={6}>Open <b>Security → App lock</b> and turn it on to open UniAttend with your fingerprint, face or phone PIN.</Step>
                </ol>
              </div>
              <div className="space-y-4 text-sm">
                <div>
                  <h3 className="font-semibold">Updating</h3>
                  <p className="mt-1 text-muted">Download the newer version from this page and install it over the old one. You stay signed in.
                    Most changes reach the app without an update, because its screens come from the website.</p>
                </div>
                <div>
                  <h3 className="font-semibold">Checking the download</h3>
                  <p className="mt-1 text-muted">The checksum proves the file is exactly the one published here. On a computer:</p>
                  <pre className="mt-2 overflow-x-auto rounded-xl bg-bg p-3 text-xs">{`Windows:  certutil -hashfile ${apk.file} SHA256\nMac/Linux: shasum -a 256 ${apk.file}`}</pre>
                </div>
              </div>
            </div>
          )}
        </section>

        <div className="grid gap-6 md:grid-cols-2">
          {/* iPhone */}
          <section aria-labelledby="iphone" className="rounded-3xl bg-surface p-6 shadow-card">
            <h2 id="iphone" className="text-xl font-semibold">iPhone and iPad</h2>
            <p className="mt-2 text-sm text-muted">Apple only installs apps from the App Store (or TestFlight for testing), so there is no iPhone
              download on this website. Use UniAttend in Safari and add it to your Home Screen instead:</p>
            <ol className="mt-3 space-y-3 text-sm">
              <Step n={1}>Open this website in <b>Safari</b> and sign in.</Step>
              <Step n={2}>Tap <b>Share</b>, then <b>Add to Home Screen</b>.</Step>
              <Step n={3}>Open UniAttend from its icon. Turn on <b>Security → App lock</b> to open it with Face ID, Touch ID or your passcode.</Step>
            </ol>
          </section>

          {/* Any browser */}
          <section aria-labelledby="browser" className="rounded-3xl bg-surface p-6 shadow-card">
            <h2 id="browser" className="text-xl font-semibold">Any other device</h2>
            <p className="mt-2 text-sm text-muted">UniAttend also installs from the browser on Android, Windows, Mac and Chromebook, with no
              download: sign in, then choose <b>Install app</b> or <b>Add to Home screen</b> from the browser&apos;s menu.</p>
            <p className="mt-3 text-sm text-muted">The installed web app keeps the same offline copy as the Android app, and its app lock
              uses your device&apos;s fingerprint, face, Windows Hello or PIN.</p>
          </section>
        </div>

        <section aria-labelledby="offline" className="rounded-3xl bg-surface p-6 shadow-card">
          <h2 id="offline" className="text-xl font-semibold">Without signal</h2>
          <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <li className="flex gap-2"><Icon name="calendar" size={18} className="mt-0.5 shrink-0 text-accent" />Your weekly timetable and the next week&apos;s dated classes, with any changes.</li>
            <li className="flex gap-2"><Icon name="book" size={18} className="mt-0.5 shrink-0 text-accent" />Your modules, and your attendance in each.</li>
            <li className="flex gap-2"><Icon name="pin" size={18} className="mt-0.5 shrink-0 text-accent" />Venues, with their map location (the map itself needs signal).</li>
            <li className="flex gap-2"><Icon name="history" size={18} className="mt-0.5 shrink-0 text-accent" />Your recent attendance history.</li>
            <li className="flex gap-2"><Icon name="scan" size={18} className="mt-0.5 shrink-0 text-accent" />Check-ins made offline are saved on your phone and sent to your lecturer to confirm when you&apos;re back online.</li>
            <li className="flex gap-2"><Icon name="shield" size={18} className="mt-0.5 shrink-0 text-accent" />The copy belongs to whoever is signed in, and is wiped when they sign out.</li>
          </ul>
          <p className="mt-4 text-sm text-muted">The copy refreshes whenever you open UniAttend with signal, and shows when it was last updated.
            Your fingerprint and face never leave your phone: the phone checks them and only tells UniAttend &ldquo;yes&rdquo; or &ldquo;no&rdquo;.
            See the <Link href="/privacy" className="text-info hover:underline">privacy notice</Link>.</p>
        </section>
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto max-w-4xl px-4 py-5 text-xs text-muted"><CompanyMark /></div>
      </footer>
    </div>
  );
}
