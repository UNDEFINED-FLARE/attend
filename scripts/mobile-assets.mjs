// Draws every UniAttend icon from the logo, public/logo.svg (the navy pin holding a QR code):
//   - Android launcher icons (legacy, round and adaptive), splash screens and the notification icon;
//   - the web app's icons (public/icons/), the browser tab icon (src/app/favicon.ico) and public/icon.svg.
// Run whenever the logo changes:  node scripts/mobile-assets.mjs   (or npm run android:assets)
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const LOGO = readFileSync("public/logo.svg", "utf8");
const [VX, VY, VW, VH] = /viewBox="([^"]+)"/.exec(LOGO)[1].split(/\s+/).map(Number);
const PATHS = [...LOGO.matchAll(/<path fill="([^"]+)" d="([^"]+)"\/>/g)].map((m) => ({ fill: m[1], d: m[2] }));
if (PATHS.length !== 3) throw new Error("public/logo.svg: expected the pin, the disc and the QR paths");
const [PIN, DISC, QR] = PATHS;
const BG = "#ffffff";   // the logo sits on white
const RES = "android/app/src/main/res";

const svg = (w, h, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`);
const png = (buf, file) => sharp(buf, { density: 300 }).png().toFile(file);

/** The logo, `height` px tall, centred on (cx, cy). `mono` draws it as one colour (status-bar icons). */
function mark(cx, cy, height, mono) {
  const k = height / VH, x = cx - (VW * k) / 2, y = cy - height / 2;
  const body = mono
    ? `<path fill="${mono}" fill-rule="evenodd" d="${PIN.d}${DISC.d}"/><path fill="${mono}" d="${QR.d}"/>`
    : PATHS.map((p) => `<path fill="${p.fill}" d="${p.d}"/>`).join("");
  return `<g transform="translate(${x} ${y}) scale(${k}) translate(${-VX} ${-VY})">${body}</g>`;
}

// ---- Android launcher icons
const DPI = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(DPI)) {
  const dir = `${RES}/mipmap-${d}`;
  const L = Math.round(48 * k), F = Math.round(108 * k);
  // Legacy square and round icons (Android 7).
  await png(svg(L, L, `<rect width="${L}" height="${L}" rx="${L * 0.22}" fill="${BG}"/>${mark(L / 2, L / 2, L * 0.7)}`), `${dir}/ic_launcher.png`);
  await png(svg(L, L, `<circle cx="${L / 2}" cy="${L / 2}" r="${L / 2}" fill="${BG}"/>${mark(L / 2, L / 2, L * 0.64)}`), `${dir}/ic_launcher_round.png`);
  // Adaptive foreground: inside the 66 dp safe zone of the 108 dp canvas (white background below).
  await png(svg(F, F, mark(F / 2, F / 2, F * 0.52)), `${dir}/ic_launcher_foreground.png`);
}
writeFileSync(`${RES}/values/ic_launcher_background.xml`,
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG.toUpperCase()}</color>\n</resources>\n`);

// ---- Splash screens (Android 11 and older; 12+ shows the launcher icon): the logo on white
for (const dir of readdirSync(RES).filter((n) => n.startsWith("drawable"))) {
  const file = `${RES}/${dir}/splash.png`;
  if (!existsSync(file)) continue;
  const { width: w, height: h } = await sharp(file).metadata();
  await png(svg(w, h, `<rect width="${w}" height="${h}" fill="${BG}"/>${mark(w / 2, h / 2, Math.min(w, h) * 0.3)}`), file + ".tmp");
  renameSync(file + ".tmp", file);
}

// ---- Notification icon: Android uses only the shape, so the pin with its window and QR, in white
const S = Math.max(VW, VH);
writeFileSync(`${RES}/drawable/ic_stat_uniattend.xml`, `<?xml version="1.0" encoding="utf-8"?>
<!-- Status-bar icon for UniAttend notifications: the logo's shape (Android uses only the shape).
     Drawn by scripts/mobile-assets.mjs from public/logo.svg. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp" android:viewportWidth="${S}" android:viewportHeight="${S}">
    <group android:translateX="${-VX + (S - VW) / 2}" android:translateY="${-VY + (S - VH) / 2}">
        <path android:fillColor="#FFFFFFFF" android:fillType="evenOdd" android:pathData="${PIN.d}${DISC.d}" />
        <path android:fillColor="#FFFFFFFF" android:pathData="${QR.d}" />
    </group>
</vector>
`);

// ---- Web app icons (manifest.webmanifest) and the browser tab icon
const square = (n, scale) => svg(n, n, `<rect width="${n}" height="${n}" fill="${BG}"/>${mark(n / 2, n / 2, n * scale)}`);
await png(square(192, 0.66), "public/icons/icon-192.png");
await png(square(512, 0.66), "public/icons/icon-512.png");
// Maskable: launchers crop to a circle or squircle, so keep the logo inside the central 80%.
await png(square(192, 0.52), "public/icons/maskable-192.png");
await png(square(512, 0.52), "public/icons/maskable-512.png");
// Notification badge: one colour on transparent.
await png(svg(96, 96, mark(48, 48, 80, "#ffffff")), "public/icons/badge-96.png");
// The logo on its white rounded tile, as one SVG (manifest "any" size, and the tab icon in modern browsers).
writeFileSync("public/icon.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><title>UniAttend</title><rect width="64" height="64" rx="14" fill="${BG}"/>${mark(32, 32, 46)}</svg>\n`);
// favicon.ico: PNG images inside an ICO container (16, 32 and 48 px), the pin on transparent.
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map((n) => sharp(svg(n, n, mark(n / 2, n / 2, n * 0.96)), { density: 300 }).png().toBuffer()));
const head = Buffer.alloc(6 + 16 * sizes.length);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let offset = head.length;
sizes.forEach((n, i) => {
  const e = 6 + 16 * i;
  head.writeUInt8(n, e); head.writeUInt8(n, e + 1); head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3);
  head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(images[i].length, e + 8); head.writeUInt32LE(offset, e + 12);
  offset += images[i].length;
});
writeFileSync("src/app/favicon.ico", Buffer.concat([head, ...images]));

console.log("Icons written: Android launcher, splash and notification icons; web app icons; favicon.");
