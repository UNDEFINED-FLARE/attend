// How a long page is moved through, chosen by the person on their own device:
//   "scroll"  - everything on one page, one part under the other (the usual web page)
//   "buttons" - a row of buttons at the top; pressing one shows that part on its own,
//               with Previous and Next underneath, like the menus in apps and games.
// Kept in a cookie (this device only) so the server draws the chosen layout straight away.

export type LayoutMode = "scroll" | "buttons";

export const LAYOUT_COOKIE = "ua_layout";

/** Anything that isn't "buttons" means the usual scrolling page. */
export function parseLayoutMode(value: string | null | undefined): LayoutMode {
  return value === "buttons" ? "buttons" : "scroll";
}

/** The part a link like "#part-today" asks for, if the page has it. */
export function partFromHash(hash: string, ids: string[]): string | null {
  const id = decodeURIComponent(hash.replace(/^#/, "")).replace(/^part-/, "");
  return ids.includes(id) ? id : null;
}
