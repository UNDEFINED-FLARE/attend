// Draws the web app icons used by the manifest and push notifications.
// Run: node scripts/web-icons.mjs
import { mkdirSync } from "node:fs";
import sharp from "sharp";

const BRAND = "#0b2545";
const check = (s, w = 6) => `<path d="M${18 * s / 64} ${33 * s / 64}l${9 * s / 64} ${9 * s / 64} ${19 * s / 64} ${-20 * s / 64}" fill="none" stroke="#fff" stroke-width="${w * s / 64}" stroke-linecap="round" stroke-linejoin="round"/>`;
const svg = (n, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${n}" height="${n}" viewBox="0 0 ${n} ${n}">${body}</svg>`);

mkdirSync("public/icons", { recursive: true });
for (const n of [192, 512]) {
  await sharp(svg(n, `<rect width="${n}" height="${n}" rx="${n * 0.22}" fill="${BRAND}"/>${check(n)}`)).png().toFile(`public/icons/icon-${n}.png`);
  // Maskable: full-bleed background, mark inside the safe zone.
  await sharp(svg(n, `<rect width="${n}" height="${n}" fill="${BRAND}"/><g transform="translate(${n * 0.2} ${n * 0.2})">${check(n * 0.6)}</g>`)).png().toFile(`public/icons/maskable-${n}.png`);
}
// Status-bar badge: white on transparent (Android uses only the alpha).
await sharp(svg(96, check(96, 8))).png().toFile("public/icons/badge-96.png");
console.log("Web icons written to public/icons/.");
