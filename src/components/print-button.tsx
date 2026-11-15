"use client";

/** Back, and the browser's print dialog (where "Save as PDF" is one of the printers). */
export function PrintButton() {
  return (
    <>
      <button type="button" onClick={() => history.back()} className="h-10 rounded-xl border border-[#d5d7da] bg-white px-4 text-sm font-medium">Back</button>
      <button type="button" onClick={() => window.print()} className="h-10 rounded-xl bg-[#1d1e20] px-4 text-sm font-semibold text-white">Save as PDF or print</button>
    </>
  );
}
