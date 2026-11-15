import type { ReactNode } from "react";
import { PrintButton } from "@/components/print-button";

/**
 * A printed or "Save as PDF" document on the institution's letterhead: its logo
 * (or initials in its colour), its name, the document title, and a footer with the
 * page number and a confidentiality line on every page. A4, plain and quiet.
 */
export function PrintDocument({ institution, logoUrl, colour, title, subtitle, meta, children }: {
  institution: string; logoUrl?: string | null; colour: string; title: string; subtitle?: string;
  meta: [string, string][]; children: ReactNode;
}) {
  const initials = institution.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).map((w) => w[0]).join("").slice(0, 3) || "U";
  const generated = new Date().toLocaleString("en-ZA", { dateStyle: "long", timeStyle: "short", timeZone: "Africa/Johannesburg" });
  return (
    <main className="doc mx-auto max-w-[210mm] bg-white px-6 py-8 text-[13px] leading-snug text-[#1d1e20] print:p-0">
      <style>{`
        @page { size: A4; margin: 16mm 14mm 18mm;
          @bottom-left { content: "${institution.replace(/"/g, "'")} · ${title.replace(/"/g, "'")} · Confidential: contains personal information"; font: 8pt system-ui, sans-serif; color: #6b6e74; }
          @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8pt system-ui, sans-serif; color: #6b6e74; } }
        @media print { body { background: #fff !important; } .doc table { break-inside: auto; } .doc tr { break-inside: avoid; }
          .doc thead { display: table-header-group; } .doc section { break-inside: avoid-page; } }
        .doc h2 { break-after: avoid; page-break-after: avoid; }
        .doc h2 + table thead { break-before: avoid; }
        .doc table { width: 100%; border-collapse: collapse; }
        .doc th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; color: #6b6e74; font-weight: 600;
          border-bottom: 1.5px solid ${colour}; padding: 6px 8px; }
        .doc td { border-bottom: 1px solid #e5e6e8; padding: 5px 8px; vertical-align: top; }
        .doc tbody tr:nth-child(even) td { background: #fafafa; }
        .doc .num { text-align: right; font-variant-numeric: tabular-nums; }
      `}</style>

      <div className="mb-4 flex justify-end gap-2 print:hidden"><PrintButton /></div>

      <header className="flex items-start justify-between gap-6 pb-4" style={{ borderBottom: `3px solid ${colour}` }}>
        <div className="flex items-center gap-4">
          {logoUrl
            // eslint-disable-next-line @next/next/no-img-element -- the institution's own logo, from its theme
            ? <img src={logoUrl} alt={`${institution} logo`} className="h-16 w-auto max-w-[180px] object-contain" />
            : <span className="grid size-14 place-items-center rounded-xl text-lg font-bold text-white" style={{ background: colour }}>{initials}</span>}
          <div>
            <p className="text-[15px] font-semibold">{institution}</p>
            <p className="text-[11px] text-[#6b6e74]">Attendance records · UniAttend</p>
          </div>
        </div>
        <div className="text-right">
          <h1 className="text-[22px] font-semibold leading-tight" style={{ color: colour }}>{title}</h1>
          {subtitle && <p className="mt-0.5 text-[12px] text-[#45484d]">{subtitle}</p>}
        </div>
      </header>

      <dl className="mt-3 mb-6 grid grid-cols-2 gap-x-6 gap-y-1 text-[11.5px] sm:grid-cols-4">
        {[...meta, ["Generated", generated] as [string, string]].map(([k, v]) => (
          <div key={k}><dt className="text-[#6b6e74]">{k}</dt><dd className="font-medium">{v}</dd></div>
        ))}
      </dl>

      {children}

      <footer className="mt-10 border-t border-[#e5e6e8] pt-3 text-[10.5px] text-[#6b6e74]">
        Contains personal information. Handle, store and dispose of it under {institution}&apos;s POPIA policy. Produced by UniAttend
        (Webbex Solutions (Pty) Ltd) for {institution}; the institution is the responsible party for these records.
      </footer>
    </main>
  );
}

/** A small figure in a printed document. */
export function DocFigure({ label, value, colour }: { label: string; value: string | number; colour?: string }) {
  return (
    <div className="rounded-lg border border-[#e5e6e8] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-[#6b6e74]">{label}</div>
      <div className="text-[18px] font-semibold tabular-nums" style={colour ? { color: colour } : undefined}>{value}</div>
    </div>
  );
}
