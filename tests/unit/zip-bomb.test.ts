import { deflateRawSync } from "node:zlib";
import { beforeAll, describe, expect, it, vi } from "vitest";

// zip.ts is marked server-only; stub that marker so the reader can be unit-tested.
vi.mock("server-only", () => ({}));
let openZip: typeof import("@/lib/zip").openZip;
beforeAll(async () => { ({ openZip } = await import("@/lib/zip")); });

// Decompression ("zip") bombs: a small .xlsx/.docx upload (both are ZIP files) that inflates to
// gigabytes and exhausts server memory. openZip must refuse one. The 5 MB upload cap limits the
// compressed size, but DEFLATE reaches ~1000:1, so the real defence is bounding the *output*.

/** Build a one-entry ZIP (deflated) by hand, so we can make the entry inflate to `uncompressedMB`. */
function zipWithDeflatedEntry(name: string, uncompressedMB: number): Uint8Array {
  const raw = Buffer.alloc(uncompressedMB * 1024 * 1024); // zeros compress tiny, inflate huge
  const comp = deflateRawSync(raw);
  const nameB = Buffer.from(name, "utf8");
  const local = Buffer.alloc(30 + nameB.length);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(raw.length >>> 0, 22); local.writeUInt16LE(nameB.length, 26);
  nameB.copy(local, 30);
  const cd = Buffer.alloc(46 + nameB.length);
  cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(raw.length >>> 0, 24); cd.writeUInt16LE(nameB.length, 28);
  cd.writeUInt32LE(0, 42); nameB.copy(cd, 46);
  const body = Buffer.concat([local, comp]);
  const cdOffset = body.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(cdOffset, 16);
  return new Uint8Array(Buffer.concat([body, cd, eocd]));
}

/** An End-of-Central-Directory that *claims* `count` entries, to hit the entry-count guard. */
function zipClaimingEntries(count: number): Uint8Array {
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(count, 8); eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(0, 12); eocd.writeUInt32LE(0, 16);
  return new Uint8Array(eocd);
}

describe("zip bomb defence (openZip)", () => {
  it("reads a normal small deflated entry", () => {
    const text = "code,name\nCSC101,Intro\n";
    const nameB = Buffer.from("a.txt", "utf8"), comp = deflateRawSync(Buffer.from(text, "utf8"));
    const local = Buffer.alloc(30 + nameB.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(text.length, 22); local.writeUInt16LE(nameB.length, 26); nameB.copy(local, 30);
    const cd = Buffer.alloc(46 + nameB.length);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(text.length, 24); cd.writeUInt16LE(nameB.length, 28); cd.writeUInt32LE(0, 42); nameB.copy(cd, 46);
    const body = Buffer.concat([local, comp]);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(body.length, 16);
    const zip = openZip(new Uint8Array(Buffer.concat([body, cd, eocd])));
    expect(zip.read("a.txt")).toBe(text);
  });

  it("refuses an entry that inflates past the 40 MB cap", () => {
    const zip = openZip(zipWithDeflatedEntry("big.bin", 60)); // 60 MB inflated > 40 MB cap
    expect(() => zip.read("big.bin")).toThrow(); // Node aborts inflate at maxOutputLength
  });

  it("refuses an archive that claims too many files", () => {
    expect(() => openZip(zipClaimingEntries(6000))).toThrow(/too many files/i);
  });

  it("rejects a file that is not a zip at all", () => {
    expect(() => openZip(new Uint8Array([1, 2, 3, 4, 5]))).toThrow(/not a zip/i);
  });
});
