import { describe, expect, it } from "vitest";
import { assertPublicHttps, privateIp } from "@/lib/url-safety";

describe("URLs the server may fetch", () => {
  it("knows private and internal addresses", () => {
    for (const ip of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.1.1", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
      expect(privateIp(ip), ip).toBe(true);
    }
    for (const ip of ["196.21.0.1", "8.8.8.8", "172.32.0.1", "2001:4860::8888"]) expect(privateIp(ip), ip).toBe(false);
  });
  it("refuses anything that is not public https", async () => {
    await expect(assertPublicHttps("http://www.tut.ac.za/timetables")).rejects.toThrow(/https/);
    await expect(assertPublicHttps("https://localhost/x")).rejects.toThrow(/public/);
    await expect(assertPublicHttps("https://10.0.0.5/x")).rejects.toThrow(/public/);
    await expect(assertPublicHttps("https://[::1]/x")).rejects.toThrow(/public/);
    await expect(assertPublicHttps("https://intranet.local/x")).rejects.toThrow(/public/);
    await expect(assertPublicHttps("https://user:pw@example.com/x")).rejects.toThrow(/username/);
    await expect(assertPublicHttps("not a url")).rejects.toThrow(/valid/);
  });
});
