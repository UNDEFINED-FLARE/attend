# Smooth on any phone

How UniAttend stays fluid on a cheap, old Android — and the honest truth about using a "faster
language" to get there.

## The one thing to understand first

UniAttend's screens are a **web app running inside Android's System WebView** (that's what Capacitor
is). On a weak phone the thing that stutters is almost never raw calculation speed — it's three
other things:

1. **The render pipeline** — layout, paint and compositing each frame. A janky animation is usually
   one that forces the browser to re-lay-out the page 60 times a second.
2. **The main thread** — there is only one, and it runs *all* your JavaScript *and* the touch/scroll
   handling. If a script is busy, scrolling freezes.
3. **Memory** — a cheap phone has little RAM; a big page or a memory spike makes Android kill or
   swap the app, which feels like a stall.

**None of those three is fixed by changing programming language.** A button animation written in C#
paints exactly as fast as one written in JavaScript, because the GPU does the painting either way.
This is the key point: see "The language trade-off" below.

## What actually makes it smooth (and what UniAttend already does)

| Lever | Why it helps a weak phone | In UniAttend |
|---|---|---|
| **Animate only `transform` and `opacity`** | These run on the GPU/compositor and skip layout + paint. Animating `width`, `height`, `top`, `margin`… forces layout every frame = jank. | Buttons/tiles press with `transform: translateY`. (One spot still animates size — the growing game tab — see "Tidy-ups".) |
| **Lite mode** | On ≤ 2 GB RAM, ≤ 2 cores, or Data Saver, drop animations, transitions and blur *before the first paint*. | `LITE_EARLY` in `src/app/layout.tsx`; `html[data-lite]` in `globals.css`. |
| **`content-visibility: auto`** | The browser skips laying out and painting rows that are off-screen. Huge on long lists. | Attendance history (`.ua-offscreen`). |
| **Keep the main thread free** | Heavy work off the main thread keeps touch and scroll responsive. | Most heavy work is in the database, not the phone (see below). |
| **Small, lazy JavaScript** | Less to download, parse and run on a slow CPU. | Routes code-split; the QR library and PDF parser load only when needed (`await import(...)`). |
| **No downloaded fonts** | A slow network doesn't block text. | System font stack. |
| **Bounded memory** | No giant DOM or unbounded parse. | Row caps, 40 MB unzip cap, off-screen rows skipped. |
| **GPU-friendly layers, used sparingly** | `will-change: transform` on a moving element hints the browser to pre-promote it — but on *everything* it wastes memory. | Use only on the element that actually moves. |
| **Passive listeners + `overscroll-behavior`** | Scrolling isn't blocked waiting for a JS handler. | Use `{ passive: true }` for scroll/touch listeners. |

The reason this app is already well-placed for cheap phones: **the expensive work doesn't happen on
the phone.** Check-in scoring, report arithmetic, roster matching — all run in Postgres on the
server. The phone mostly shows results. That is the single biggest performance decision, and it's
already made.

## The language trade-off — the honest answer

You're right that choosing a language trades something for speed. The usual trade is:

- **JavaScript / TypeScript** (what the UI is in): slower raw math, but it runs in every browser and
  WebView, updates instantly with no app-store release, and is where UI code *belongs*.
- **C# / Java / Kotlin / Swift**: fast and native, but tied to one platform, and a change means a new
  Play Store build and review every time.
- **Rust / C / C++**: fastest, but heavy to write and easy to get wrong.

Here's the part that matters for UniAttend: **the UI is not CPU-bound, so making the language faster
buys nothing you can feel.** A gold Check-in button, a sliding tab, a list — these cost *render* and
*memory*, not computation. Rewriting them in C# would:

- **not** make a single animation smoother (the GPU already paints them), and
- **cost you the superpower** that the whole app is built around: web changes reach every phone
  instantly, with no Play Store update. A native rewrite throws that away and gives you two codebases
  to maintain.

So for the UI: the fastest language is the wrong lever. The right levers are the table above.

### Where a faster language *is* the right call (your instinct, applied correctly)

The honest, professional version of "use a fast language for the hot part" is not "rewrite the app."
It's: **find the one piece of code that is genuinely CPU-bound and runs on the phone, and either move
it off the main thread (a Web Worker) or compile it to WebAssembly (Rust/C++/AssemblyScript) — or
both.** That's the polyglot approach done right: JavaScript for the 95% that is UI, a fast compiled
module for the 5% that is real computation.

In UniAttend there is exactly **one** such hotspot:

- **QR decoding at check-in** (`html5-qrcode`, in `src/app/student/check-in/check-in.tsx` and the
  lecturer card scanner). It inspects camera frames many times a second **on the main thread**, which
  is what can make a cheap phone feel laggy *while the scanner is open*. Everything else on the phone
  is cheap.

The right fix, in order of value:

1. **Decode in a Web Worker.** Read frames from the camera into an `OffscreenCanvas` and run the
   decoder in a background thread, so the main thread stays free for scrolling and taps. Biggest win,
   pure JavaScript, no new language.
2. **Use a WASM decoder** (e.g. `zxing-wasm`, compiled from C++) inside that worker. It decodes a
   frame faster than the JS library, so a weak phone reads the code in fewer frames and uses less
   battery. This is the legitimate "faster language" improvement — scoped to the one place it pays
   off, not a rewrite.

Expected effect on a low-end phone: the scanner screen scrolls and responds smoothly while scanning,
and the QR reads faster in poor light. The other 99% of the app is unchanged.

> This is a real change to the check-in path and should be tested on actual phones (Play internal
> testing) before shipping. It is offered, not yet built — ask and it goes on its own branch with the
> before/after measured.

### When a full native rewrite is actually warranted

Rarely, and not here. It's worth it when the app's core *is* heavy on-device computation —
real-time video effects, 3D, on-device machine learning, a game engine. UniAttend is a
forms-and-lists app whose hard work is on the server. A native rewrite (Kotlin + Jetpack Compose, or
Flutter) would cost months, two codebases, and the instant-update advantage, to make things that are
already smooth no smoother. **Verdict: don't.**

## Tidy-ups worth doing (small, in-app)

- The growing tab in the game tab bar animates `width`/`height` (`.g-tab-tile` in `game-look.css`),
  which animates layout. It only runs on a tap (not during scroll), so the impact is small, but it
  could move to `transform: scale()` to stay fully on the compositor. Low priority.
- Add `{ passive: true }` to any scroll/touch listener that doesn't call `preventDefault`.
- Keep `will-change` off elements that aren't currently moving.

## The checklist

1. Animate only `transform`/`opacity`; never `transition: all`.
2. Keep lite mode working (test with a throttled CPU in dev tools).
3. `content-visibility: auto` on any long list.
4. Heavy work on the server or in a Web Worker — never block the main thread.
5. Code-split and lazy-load big libraries (QR, PDF).
6. Measure on a real cheap phone, or Chrome DevTools → Performance with 4× CPU throttle, before and
   after any change. Don't guess.
7. Reach for a faster language only for a measured, CPU-bound, on-device hotspot — and put it in a
   Worker/WASM module, not the whole app.
