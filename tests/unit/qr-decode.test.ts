import QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import { decodeFrame } from "@/lib/qr-decode";

// Proves the off-thread decoder (qr-decode.ts, run in qr-decode.worker.ts) actually reads a real
// UniAttend check-in QR — the same decode that runs on the phone, tested here with no browser.

/** Render `text` as a QR into an RGBA pixel buffer, like a camera frame of the projector. */
function raster(text: string, scale = 8, quiet = 4): { data: Uint8ClampedArray; w: number; h: number } {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = qr.modules.size, bits = qr.modules.data;
  const dim = size + quiet * 2, w = dim * scale, h = dim * scale;
  const data = new Uint8ClampedArray(w * h * 4).fill(255); // white, opaque
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!bits[y * size + x]) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = (x + quiet) * scale + dx, py = (y + quiet) * scale + dy;
          const i = (py * w + px) * 4;
          data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255;
        }
      }
    }
  }
  return { data, w, h };
}

describe("decodeFrame", () => {
  it("reads a UniAttend check-in QR back exactly", () => {
    const url = "https://attend.example/student/check-in?s=11111111-1111-1111-1111-111111111111&t=2873451.AbCdEfGhIjKlMnOpQrStUv";
    const { data, w, h } = raster(url);
    expect(decodeFrame(data, w, h)).toBe(url);
  });

  it("reads a short join code too", () => {
    const { data, w, h } = raster("CSC101-7F3A");
    expect(decodeFrame(data, w, h)).toBe("CSC101-7F3A");
  });

  it("returns null for an empty or too-small frame instead of throwing", () => {
    expect(decodeFrame(new Uint8ClampedArray(0), 0, 0)).toBeNull();
    expect(decodeFrame(new Uint8ClampedArray(4), 1, 1)).toBeNull();
    // A plain grey frame (no code) decodes to nothing.
    const grey = new Uint8ClampedArray(64 * 64 * 4).fill(128);
    expect(decodeFrame(grey, 64, 64)).toBeNull();
  });
});
