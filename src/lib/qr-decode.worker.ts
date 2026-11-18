/// <reference lib="webworker" />
import { decodeFrame } from "./qr-decode";

// Runs QR decoding off the main thread, so scrolling and taps stay smooth while the camera is
// open — the one real on-device hotspot (see docs/PERFORMANCE.md). The page (qr-scanner.ts) sends
// one frame's pixels per tick; we decode and, only when we find a code, send the text back.
self.onmessage = (e: MessageEvent<{ buffer: ArrayBuffer; width: number; height: number }>) => {
  const { buffer, width, height } = e.data;
  try {
    const text = decodeFrame(new Uint8ClampedArray(buffer), width, height);
    if (text) (self as unknown as Worker).postMessage({ text });
  } catch {
    /* a bad frame is ignored; the next tick tries again */
  }
};
