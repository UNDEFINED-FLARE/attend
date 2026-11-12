import Link from "next/link";
import { Icon } from "@/components/icons";
import { loadBranding } from "@/lib/branding";
import { themeStyle } from "@/lib/theme";

// Sign-in, registration and password pages wear the institution's look when
// we know it (/login?i=<slug>, or the last institution used on this device).
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const { name, theme } = await loadBranding();
  const title = theme.header.title || name || "UniAttend";
  const logo = theme.header.logoUrl;
  const mark = logo
    // eslint-disable-next-line @next/next/no-img-element -- the institution's logo (admin-set https URL)
    ? <img src={logo} alt="" className="size-11 shrink-0 rounded-2xl bg-white object-contain p-1" referrerPolicy="no-referrer" />
    : <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white/15"><Icon name="check" size={22} strokeWidth={2.6} /></span>;
  return (
    <div style={themeStyle(theme)} className="grid min-h-dvh font-sans lg:grid-cols-2">
      <aside className="hidden flex-col justify-between bg-brand p-10 text-brand-ink lg:flex">
        <Link href="/" className="flex items-center gap-3">
          {mark}
          <span className="leading-tight">
            <span className="block text-lg font-semibold">{title}</span>
            {name && title !== name && <span className="block text-sm opacity-75">{name}</span>}
          </span>
        </Link>
        <div className="max-w-md space-y-4">
          <p className="text-3xl font-semibold leading-tight">{theme.login.headline}</p>
          {theme.login.message && <p className="opacity-80">{theme.login.message}</p>}
        </div>
        <p className="text-sm opacity-60">{name ? "Attendance by UniAttend · POPIA-conscious by design." : "POPIA-conscious by design."}</p>
      </aside>
      <main className="flex flex-col items-center justify-center gap-6 p-4 sm:p-10">
        {/* Phones: the institution's identity above the form. */}
        <div className="flex w-full max-w-sm items-center gap-3 rounded-3xl bg-brand p-4 text-brand-ink shadow-card lg:hidden">
          {mark}
          <span className="min-w-0 leading-tight">
            <span className="block truncate font-semibold">{title}</span>
            <span className="line-clamp-2 block text-xs opacity-80">{theme.login.headline}</span>
          </span>
        </div>
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
