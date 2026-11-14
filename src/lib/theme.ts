// An institution's look: colours, shape, header, sidebar, footer, an
// announcement banner and the student home layout. Stored as JSON on the
// institution; always parsed through parseTheme so a bad or old value can
// never break a page — anything invalid falls back to the default.
import { z } from "zod";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const text = (max: number) => z.string().trim().max(max);
const httpsUrl = z.union([z.literal(""), z.string().trim().max(500).regex(/^https:\/\/[^\s"'<>]+$/, "Use an https:// link")]);
const link = z.object({ label: text(40).min(1), url: z.string().trim().max(500).regex(/^(https:\/\/|mailto:|\/)[^\s"'<>]*$/, "Links must start with https://, mailto: or /") });

export const STUDENT_CARDS = ["hero", "live", "quick", "today", "modules", "recent"] as const;
export type StudentCard = (typeof STUDENT_CARDS)[number];
export const CARD_LABEL: Record<StudentCard, string> = {
  hero: "Attendance summary", live: "Check-in prompt", quick: "At a glance", today: "Today's classes", modules: "My modules", recent: "Recent",
};

const menuItem = z.object({ href: z.string().regex(/^\/[a-z0-9/_-]*$/), label: text(30), show: z.boolean() });

/** Optional parts of UniAttend an institution can switch off. */
export const FEATURES = {
  earlyWarning: ["Early warning", "Automatic alerts and follow-up for students with low attendance."],
  cardScanning: ["Student card scanning", "Lecturers scan student cards (camera or USB scanner) to check students in and out."],
  printedQr: ["Printed QR codes", "A fixed QR code to print, accepted only together with the location check."],
  checkOut: ["Check-out", "Students tap \"I'm leaving\"; leaving early is recorded."],
  directions: ["Walking directions", "\"Find my class\" guides students to their next venue."],
  calendarDownload: ["Timetable download", "Students and lecturers download their timetable for their phone's calendar."],
  liveClass: ["Live class screen", "After check-in, a live screen with the time left until the class ends."],
} as const;

const palette = z.object({
  primary: hex, accent: hex, background: hex, surface: hex, text: hex, muted: hex,
  success: hex, warning: hex, danger: hex,
});

export const ThemeSchema = z.object({
  colors: palette,
  /** Light, dark, or follow each person's phone/computer setting (uses the dark palette at night). */
  appearance: z.object({ mode: z.enum(["light", "dark", "auto"]), dark: palette }),
  /** The sign-in and registration screens. */
  login: z.object({ headline: text(80), message: text(240) }),
  shape: z.enum(["sharp", "rounded", "soft"]),
  font: z.enum(["system", "serif", "rounded", "mono"]),
  header: z.object({
    style: z.enum(["light", "solid", "gradient"]), gradientTo: hex,
    title: text(60), subtitle: text(80), logoUrl: httpsUrl, showDate: z.boolean(),
  }),
  sidebar: z.object({ style: z.enum(["light", "dark", "brand"]) }),
  footer: z.object({ show: z.boolean(), text: text(200), links: z.array(link).max(6) }),
  announcement: z.object({ show: z.boolean(), text: text(240), tone: z.enum(["info", "ok", "warn", "bad"]) }),
  features: z.object(Object.fromEntries(Object.keys(FEATURES).map((k) => [k, z.boolean()])) as Record<keyof typeof FEATURES, z.ZodBoolean>),
  menus: z.object({ student: z.array(menuItem).max(20), lecturer: z.array(menuItem).max(20), admin: z.array(menuItem).max(20) }),
  student: z.object({
    greeting: text(60), heroTitle: text(60), heroFrom: hex, heroTo: hex,
    cards: z.array(z.object({ id: z.enum(STUDENT_CARDS), show: z.boolean(), title: text(40) })).length(STUDENT_CARDS.length)
      .refine((cs) => new Set(cs.map((c) => c.id)).size === STUDENT_CARDS.length, "Each student card must appear once"),
  }),
});
export type Theme = z.infer<typeof ThemeSchema>;

export const DEFAULT_THEME: Theme = {
  // Minimal graphite: light grey surfaces, dark grey ink and buttons, muted status colours.
  colors: { primary: "#2d2f33", accent: "#45484d", background: "#e7e8ea", surface: "#f5f5f6", text: "#1d1e20", muted: "#6b6e74",
            success: "#3d7a55", warning: "#9a6a1f", danger: "#a8443d" },
  appearance: {
    mode: "light",
    dark: { primary: "#d7dade", accent: "#7a808a", background: "#17181a", surface: "#222427", text: "#e6e7e9", muted: "#9a9ea5",
            success: "#6fbf8b", warning: "#d9a94e", danger: "#e07a72" },
  },
  login: { headline: "Attendance you can stand behind.", message: "Sign in with your institution account to check in, see your timetable and follow your attendance." },
  shape: "rounded",
  font: "system",
  header: { style: "light", gradientTo: "#45484d", title: "", subtitle: "", logoUrl: "", showDate: true },
  sidebar: { style: "light" },
  footer: { show: false, text: "", links: [] },
  announcement: { show: false, text: "", tone: "info" },
  features: Object.fromEntries(Object.keys(FEATURES).map((k) => [k, true])) as Theme["features"],
  // Empty means "the app's default menus"; the Design page fills them in when edited.
  menus: { student: [], lecturer: [], admin: [] },
  student: {
    greeting: "{greeting}", heroTitle: "Your attendance", heroFrom: "#45484d", heroTo: "#2d2f33",
    cards: STUDENT_CARDS.map((id) => ({ id, show: true, title: CARD_LABEL[id] })),
  },
};

/** Merge a stored value over the defaults, section by section; invalid sections fall back. */
export function parseTheme(raw: unknown): Theme {
  if (!raw || typeof raw !== "object") return DEFAULT_THEME;
  const r = raw as Record<string, unknown>;
  const out = structuredClone(DEFAULT_THEME) as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_THEME) as (keyof Theme)[]) {
    const merged = typeof r[key] === "object" && r[key] && typeof DEFAULT_THEME[key] === "object"
      ? { ...(DEFAULT_THEME[key] as object), ...(r[key] as object) } : r[key] ?? DEFAULT_THEME[key];
    const ok = ThemeSchema.shape[key].safeParse(merged);
    if (ok.success) out[key] = ok.data;
  }
  return out as Theme;
}

const RADIUS = { sharp: ["4px", "6px", "8px"], rounded: ["12px", "16px", "24px"], soft: ["16px", "22px", "32px"] } as const;
const FONT = {
  system: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, Cambria, "Times New Roman", Times, serif',
  rounded: 'ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", ui-sans-serif, system-ui, sans-serif',
  mono: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
} as const;

/** Readable text colour (black or white) on a background. */
export function inkOn(bg: string): string {
  const n = parseInt(bg.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? "#0f1b2d" : "#ffffff";
}

type Palette = Theme["colors"];
const isDark = (c: Palette) => inkOn(c.background) === "#ffffff";

function paletteVars(c: Palette, prefix: "--" | "--d-"): Record<string, string> {
  const v = (k: string, val: string) => [`${prefix}${k}`, val] as const;
  return Object.fromEntries([
    v("brand", c.primary), v("brand-ink", inkOn(c.primary)), v("accent", c.accent), v("bg", c.background), v("surface", c.surface),
    v("ink", c.text), v("muted", c.muted), v("ok", c.success), v("warn", c.warning), v("bad", c.danger), v("info", c.accent),
    v("line", `color-mix(in srgb, ${c.text} ${isDark(c) ? 16 : 13}%, ${c.background})`),
    v("hi", isDark(c) ? "rgb(255 255 255 / 0.04)" : "rgb(255 255 255 / 0.7)"),
  ]);
}

/** The colours in use for a light or dark screen. */
export function paletteFor(t: Theme, scheme: "light" | "dark"): Palette {
  return t.appearance.mode === "dark" || (t.appearance.mode === "auto" && scheme === "dark") ? t.appearance.dark : t.colors;
}

/**
 * CSS custom properties that restyle every component under the element they are set on.
 * In "auto" mode the dark palette rides along as --d-* and globals.css swaps it in
 * when the device prefers dark (see [style*="--d-bg"] there).
 */
export function themeStyle(t: Theme, scheme?: "light" | "dark"): Record<string, string> {
  const [xl, xxl, xxxl] = RADIUS[t.shape];
  const mode = scheme ?? (t.appearance.mode === "auto" ? "light" : t.appearance.mode);
  const main = paletteFor(t, mode);
  return {
    ...paletteVars(main, "--"),
    ...(t.appearance.mode === "auto" && !scheme ? paletteVars(t.appearance.dark, "--d-") : {}),
    "--radius-xl": xl, "--radius-2xl": xxl, "--radius-3xl": xxxl, "--font-sans": FONT[t.font],
    colorScheme: t.appearance.mode === "auto" && !scheme ? "light dark" : isDark(main) ? "dark" : "light",
    background: "var(--bg)", color: "var(--ink)",
  };
}
