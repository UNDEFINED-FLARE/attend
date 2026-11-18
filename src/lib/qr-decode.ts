import jsQR from "jsqr";

// Pure QR decode: a frame's pixels in, the decoded text (or null) out. No DOM, no camera,
// so it runs in a Web Worker (off the main thread — see qr-decode.worker.ts) and in tests.
// `data` is RGBA, 4 bytes per pixel, length === width * height * 4 (an ImageData buffer).
export function decodeFrame(data: Uint8ClampedArray, width: number, height: number): string | null {
  if (!width || !height || data.length < width * height * 4) return null;
  // "dontInvert" is the fast path (a QR on the projector is dark-on-light); it keeps each
  // frame cheap so a weak phone stays responsive.
  const r = jsQR(data, width, height, { inversionAttempts: "dontInvert" });
  return r && r.data ? r.data : null;
}
