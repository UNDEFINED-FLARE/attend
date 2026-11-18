// Camera QR scanner that decodes OFF the main thread (qr-decode.worker.ts), so even a very old,
// slow phone scrolls and taps smoothly while scanning. The camera and the cheap frame-grab stay on
// the main thread (a worker can't open a camera); the expensive decode runs in the worker.
//
// It degrades gracefully: supportsWorkerScan() says whether this device can do it, and startWorkerScan
// throws if the camera won't start — the caller (check-in) then falls back to the html5-qrcode
// scanner, so check-in is never worse than before on any phone.

export type ScanHandle = { stop: () => Promise<void> };

/** True when this device can grab frames and run a Web Worker. Camera errors are handled at start. */
export function supportsWorkerScan(): boolean {
  try {
    return typeof Worker !== "undefined"
      && typeof document !== "undefined"
      && !!navigator.mediaDevices?.getUserMedia
      && !!document.createElement("canvas").getContext("2d");
  } catch {
    return false;
  }
}

/**
 * Start scanning into `mount` (a UniAttend #qr-reader box; a <video> is appended and styled by it).
 * Calls onResult once with the decoded text, then keeps running until you stop() it.
 * Throws if the camera cannot start.
 */
export async function startWorkerScan(mount: HTMLElement, onResult: (text: string) => void): Promise<ScanHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });

  const video = document.createElement("video");
  video.setAttribute("playsinline", "");
  video.muted = true;
  video.autoplay = true;
  video.srcObject = stream;
  mount.appendChild(video);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL("./qr-decode.worker.ts", import.meta.url));
  } catch (e) {
    // Couldn't create the worker: clean up and let the caller fall back.
    stream.getTracks().forEach((t) => t.stop());
    video.remove();
    throw e;
  }

  let stopped = false;
  let busy = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  const MAX = 480; // decode a downscaled frame; plenty for a projected QR, and cheap to grab

  worker.onmessage = (e: MessageEvent<{ text?: string }>) => {
    busy = false;
    if (!stopped && e.data?.text) onResult(e.data.text);
  };
  worker.onerror = () => { busy = false; };

  try { await video.play(); } catch { /* some WebViews play without the promise resolving */ }

  const pump = () => {
    if (stopped || busy || !ctx) return;
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return;
    const scale = Math.min(1, MAX / Math.max(vw, vh));
    const w = Math.max(1, Math.round(vw * scale)), h = Math.max(1, Math.round(vh * scale));
    canvas.width = w; canvas.height = h;
    ctx.drawImage(video, 0, 0, w, h);
    let img: ImageData;
    try { img = ctx.getImageData(0, 0, w, h); } catch { return; }
    busy = true;
    // Transfer the pixel buffer so nothing is copied; a fresh buffer is made next tick.
    worker.postMessage({ buffer: img.data.buffer, width: w, height: h }, [img.data.buffer]);
  };
  timer = setInterval(pump, 120); // ~8 samples/sec on the main thread; the decode is off-thread

  return {
    stop: async () => {
      stopped = true;
      if (timer) clearInterval(timer);
      try { worker?.terminate(); } catch { /* ignore */ }
      try { stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
      try { video.srcObject = null; video.remove(); } catch { /* ignore */ }
    },
  };
}
