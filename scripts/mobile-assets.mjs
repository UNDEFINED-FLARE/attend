// Draws the Android launcher icons and splash screens from the UniAttend mark.
// Run after `cap add android`, or whenever the logo changes: node scripts/mobile-assets.mjs
import { readdirSync, existsSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const BRAND = "#0b2545";
const RES = "android/app/src/main/res";
const check = (s, w = 6) => `<path d="M${18 * s / 64} ${33 * s / 64}l${9 * s / 64} ${9 * s / 64} ${19 * s / 64} ${-20 * s / 64}" fill="none" stroke="#fff" stroke-width="${w * s / 64}" stroke-linecap="round" stroke-linejoin="round"/>`;
const svg = (w, h, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`);
const png = (buf, file) => sharp(buf).png().toFile(file);

const DPI = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(DPI)) {
  const dir = `${RES}/mipmap-${d}`;
  const L = Math.round(48 * k), F = Math.round(108 * k);
  // Legacy square and round icons (Android 7).
  await png(svg(L, L, `<rect width="${L}" height="${L}" rx="${L * 0.22}" fill="${BRAND}"/>${check(L)}`), `${dir}/ic_launcher.png`);
  await png(svg(L, L, `<circle cx="${L / 2}" cy="${L / 2}" r="${L / 2}" fill="${BRAND}"/>${check(L)}`), `${dir}/ic_launcher_round.png`);
  // Adaptive foreground: the mark inside the 66 dp safe zone of a 108 dp canvas.
  const inner = F * 0.5, off = (F - inner) / 2;
  await png(svg(F, F, `<g transform="translate(${off} ${off})">${check(inner, 7)}</g>`), `${dir}/ic_launcher_foreground.png`);
}
writeFileSync(`${RES}/values/ic_launcher_background.xml`,
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BRAND}</color>\n</resources>\n`);

// Splash screens: brand colour with the mark in the middle, at each existing size.
for (const dir of readdirSync(RES).filter((n) => n.startsWith("drawable"))) {
  const file = `${RES}/${dir}/splash.png`;
  if (!existsSync(file)) continue;
  const { width: w, height: h } = await sharp(file).metadata();
  const m = Math.min(w, h) * 0.28;
  await png(svg(w, h, `<rect width="${w}" height="${h}" fill="${BRAND}"/><g transform="translate(${(w - m) / 2} ${(h - m) / 2})">${check(m, 7)}</g>`), file + ".tmp");
  const { renameSync } = await import("node:fs");
  renameSync(file + ".tmp", file);
}
console.log("Android icons and splash screens written.");
