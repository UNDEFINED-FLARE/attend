// How the student app looks on this device, chosen by the student:
//   "simple" - the institution's own design (the default)
//   "game"   - a mobile-game style: a deep-blue arena with a big Check in button, today's classes as
//              a row of slots, modules as a deck of cards, and chunky buttons that press down
// Kept in a cookie (this device only) so the server draws the chosen look straight away.

export type Look = "simple" | "game";

export const LOOK_COOKIE = "ua_look";

/** Anything that isn't "game" means the institution's own design. */
export function parseLook(value: string | null | undefined): Look {
  return value === "game" ? "game" : "simple";
}
