// The company details every legal page uses: the privacy notice, terms, PAIA manual
// and footer. Fill these in once the company is registered and the Information
// Officer is registered with the Information Regulator. Anything left null shows as
// "[to be completed]" on the pages, so a gap is visible rather than invented.

export const LEGAL = {
  /** Registered company that operates UniAttend. */
  company:"Webbex Solutions (Pty) Ltd" as string | null,
  /** CIPC registration number, e.g. "2026/123456/07". */
  registration: "2026/690092/07" as string | null,
  /** Physical and postal address. */
  address: "Stand No 619 Block F, Mutshidzi Street, Thohoyandou, Limpopo, 0950" as string | null,
  /** Head of the company (PAIA section 51: the "head of a private body"). */
  head: null as string | null,
  /** Information Officer (POPIA s 55), registered on the Information Regulator's eServices portal. */
  informationOfficer: null as string | null,
  /** Where privacy questions and requests go. */
  privacyEmail: null as string | null,
  /** General support. */
  supportEmail: null as string | null,
  phone: null as string | null,
  /** Where the personal information is stored. Keep in step with the Supabase project's region. */
  hostingRegion: "the European Union (Ireland)",
  /** When the privacy notice last changed in substance. */
  privacyUpdated: "13 November 2026",
  paiaUpdated: "13 November 2026",
};

export const TBC = "[to be completed]";
export const show = (v: string | null) => v ?? TBC;

/** Organisations that process personal information for UniAttend (sub-operators). */
export const SUB_OPERATORS: { name: string; purpose: string; where: string; data: string }[] = [
  { name: "Supabase Inc.", purpose: "Database, sign-in and file storage", where: "European Union (Ireland)", data: "All account and attendance records" },
  { name: "Vercel Inc.", purpose: "Runs the website and app", where: "Global network", data: "Requests passing through (not stored, apart from short-lived logs)" },
  { name: "Google, Apple and Mozilla push services", purpose: "Delivering phone notifications, if you turn them on", where: "Global", data: "The notification text and a device address" },
  { name: "Cloudflare (Turnstile)", purpose: "Checking sign-ins come from a person, if your institution's site has it on", where: "Global", data: "Technical browser signals; no account data" },
  { name: "HeiGIT gGmbH (OpenRouteService)", purpose: "Walking directions to your venue", where: "Germany", data: "Start and end points only, with no name or account" },
  { name: "OpenStreetMap tile servers", purpose: "Map images", where: "Global", data: "Your IP address, as with any web map" },
];
