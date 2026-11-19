/**
 * The UniAttend logo: the navy location pin holding a QR code, on a white tile
 * (public/logo.svg; the app icons are drawn from the same file by
 * scripts/mobile-assets.mjs). Shown wherever an institution hasn't set its own logo.
 */
export function BrandMark({ className = "size-9", rounded = "rounded-xl" }: { className?: string; rounded?: string }) {
  return (
    <span className={`grid shrink-0 place-items-center bg-white ring-1 ring-black/5 ${rounded} ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a small static SVG */}
      <img src="/logo.svg" alt="" className="h-[74%] w-auto" draggable={false} />
    </span>
  );
}
