// Module colours in the minimal graphite look: dark-to-mid greys that stay readable
// with white text, so modules are told apart by shade, not by bright colour.
export const MODULE_SHADES = ["#2d2f33", "#45484d", "#5c5f65", "#3a3d42", "#52555b", "#686b71", "#25272a", "#4f5257"];

export const moduleShade = (code: string) => MODULE_SHADES[[...code].reduce((a, c) => a + c.charCodeAt(0), 0) % MODULE_SHADES.length];
