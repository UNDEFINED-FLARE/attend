"use client";
export function PrintButton() {
  return <button type="button" onClick={() => window.print()} className="h-11 rounded-xl bg-[#0b2545] px-5 font-semibold text-white">Print</button>;
}
