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

export const ThemeSchema = z.object({
  colors: z.object({
    primary: hex, accent: hex, background: hex, surface: hex, text: hex, muted: hex,
    success: hex, warning: hex, danger: hex,
  }),
  shape: z.enum(["sharp", "rounded", "soft"]),
  font: z.enum(["system", "serif", "rounded", "mono"]),
  header: z.object({
    style: z.enum(["light", "solid", "gradient"]), gradientTo: hex,
    title: text(60), subtitle: text(80), logoUrl: httpsUrl, showDate: z.boolean(),
  }),
  sidebar: z.object({ style: z.enum(["light", "dark", "brand"]) }),
  footer: z.object({ show: z.boolean(), text: text(200), links: z.array(link).max(6) }),
  announcement: z.object({ show: z.boolean(), text: text(240), tone: z.enum(["info", "ok", "warn", "bad"]) }),
  student: z.object({
    greeting: text(60), heroTitle: text(60), heroFrom: hex, heroTo: hex,
    cards: z.array(z.object({ id: z.enum(STUDENT_CARDS), show: z.boolean(), title: text(40) })).length(STUDENT_CARDS.length)
      .refine((cs) => new Set(cs.map((c) => c.id)).size === STUDENT_CARDS.length, "Each student card must appear once"),
  }),
});
export type Theme = z.infer<typeof ThemeSchema>;

export const DEFAULT_THEME: Theme = {
  colors: { primary: "#0b2545", accent: "#2f6fed", background: "#f3f6fb", surface: "#ffffff", text: "#0f1b2d", muted: "#64748b",
            success: "#16a34a", warning: "#d97706", danger: "#dc2626" },
  shape: "rounded",
  font: "system",
  header: { style: "light", gradientTo: "#2f6fed", title: "", subtitle: "", logoUrl: "", showDate: true },
  sidebar: { style: "light" },
  footer: { show: false, text: "", links: [] },
  announcement: { show: false, text: "", tone: "info" },
  student: {
    greeting: "{greeting}", heroTitle: "Your attendance", heroFrom: "#1d4ed8", heroTo: "#0b2545",
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

/** CSS custom properties that restyle every component under the element they are set on. */
export function themeStyle(t: Theme): Record<string, string> {
  const [xl, xxl, xxxl] = RADIUS[t.shape];
  return {
    "--brand": t.colors.primary, "--brand-ink": inkOn(t.colors.primary), "--accent": t.colors.accent,
    "--bg": t.colors.background, "--surface": t.colors.surface, "--ink": t.colors.text, "--muted": t.colors.muted,
    "--ok": t.colors.success, "--warn": t.colors.warning, "--bad": t.colors.danger, "--info": t.colors.accent,
    "--radius-xl": xl, "--radius-2xl": xxl, "--radius-3xl": xxxl, "--font-sans": FONT[t.font],
    background: t.colors.background, color: t.colors.text,
  };
}
