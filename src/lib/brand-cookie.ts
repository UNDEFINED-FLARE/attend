/** Which institution's look the sign-in pages wear on this device (slug or id; not a secret). */
export const BRAND_COOKIE = "ua_brand";
export const BRAND_COOKIE_OPTIONS = { httpOnly: true, sameSite: "lax" as const, secure: true, path: "/", maxAge: 400 * 24 * 3600 };
