// Short two-tone chime generated with the Web Audio API, so the app can prove
// sound output works in the browser and inside the Android WebView without
// shipping an audio file.
let ctx: AudioContext | null = null;

export async function playChime(): Promise<boolean> {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return false;
  ctx ??= new AC();
  if (ctx.state === "suspended") {
    // Browsers only allow audio after a user tap; never let that block the caller.
    await Promise.race([ctx.resume(), new Promise((resolve) => setTimeout(resolve, 500))]);
  }
  if (ctx.state !== "running") return false;
  const audio = ctx;
  const start = audio.currentTime;
  [880, 1320].forEach((freq, i) => {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const t = start + i * 0.18;
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.4);
  });
  return true;
}

/** Browser vibration (Chrome on Android). Returns false where unsupported. */
export function webVibrate(pattern: number | number[]): boolean {
  return typeof navigator.vibrate === "function" ? navigator.vibrate(pattern) : false;
}
