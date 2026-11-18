// How the student app looks on this device, chosen by the student:
//   "game"   - the default: a mobile game's layout in the app's own style. One big Check in
//              button, today's classes as a row of slots, modules as a deck of cards, buttons
//              and cards that press down, and a tab bar whose open tab grows
//   "simple" - the earlier layout (account menu > Simple look)
// Kept in a cookie (this device only) so the server draws the chosen look straight away.

export type Look = "simple" | "game";

export const LOOK_COOKIE = "ua_look";

/** Everyone gets the game look unless this device chose the simple one. */
export function parseLook(value: string | null | undefined): Look {
  return value === "simple" ? "simple" : "game";
}
