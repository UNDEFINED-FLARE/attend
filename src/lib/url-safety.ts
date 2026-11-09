import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// Checks for any URL the server fetches on an administrator's behalf: https
// only, no credentials, and no private, loopback or internal addresses, both
// by name and after DNS resolution (so a public name pointing inward is refused).

export function privateIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80")) return true;
    const mapped = /::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    return mapped ? privateIp(mapped[1]) : false;
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}


/** Throws unless the URL is https on a public host. */
export async function assertPublicHttps(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("That is not a valid web address."); }
  if (u.protocol !== "https:") throw new Error("Timetable links must start with https://");
  if (u.username || u.password) throw new Error("Timetable links can't contain a username or password.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) || host === "localhost" || /\.(local|internal|localhost|lan|home)$/i.test(host) || !host.includes(".")) {
    throw new Error("Timetable links must use a public web address.");
  }
  const addrs = await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error(`Couldn't find ${host}.`);
  if (addrs.some((a) => privateIp(a.address))) throw new Error("Timetable links must use a public web address.");
  return u;
}
