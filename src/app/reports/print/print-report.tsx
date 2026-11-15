"use client";

/** Opens the browser's print dialog, where "Save as PDF" is one of the printers. */
export function PrintReport() {
  return (
    <div className="flex gap-2 print:hidden">
      <button type="button" onClick={() => history.back()} className="h-10 rounded-xl border border-line px-4 text-sm font-medium">Back</button>
      <button type="button" onClick={() => window.print()} className="h-10 rounded-xl bg-ink px-4 text-sm font-semibold text-surface">Print or save as PDF</button>
    </div>
  );
}
