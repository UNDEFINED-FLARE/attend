"use client";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

/** A code to scan from a computer screen, so the download lands on the phone. Hidden on phones. */
export function DownloadQr({ href }: { href: string }) {
  const [img, setImg] = useState<string | null>(null);
  useEffect(() => {
    // The page's own address, not the APK's: the phone gets the install steps and the checksum too.
    const url = new URL("/app", window.location.origin).href;
    void QRCode.toDataURL(url, { width: 320, margin: 1, errorCorrectionLevel: "M" }).then(setImg).catch(() => setImg(null));
  }, [href]);
  if (!img) return null;
  return (
    <figure className="hidden shrink-0 text-center sm:block">
      {/* eslint-disable-next-line @next/next/no-img-element -- a generated data: URL */}
      <img src={img} alt="QR code for this page" width={140} height={140} className="rounded-xl bg-white p-1.5" />
      <figcaption className="mt-1 text-xs text-muted">Scan with your phone</figcaption>
    </figure>
  );
}
