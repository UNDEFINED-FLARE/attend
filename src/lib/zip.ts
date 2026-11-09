import "server-only";
import { inflateRawSync } from "node:zlib";

// A small ZIP reader for .xlsx and .docx uploads. Reads the central directory,
// supports stored and deflated entries, and refuses archives that expand too far.

const MAX_ENTRIES = 5000;
const MAX_TOTAL = 40 * 1024 * 1024; // 40 MB uncompressed across the entries we read

export type Zip = { names: string[]; read: (name: string) => string | null };

export function openZip(buf: Uint8Array): Zip {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  // End of central directory: the last 0x06054b50 within the final 64 KB.
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) {
    if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  if (count > MAX_ENTRIES) throw new Error("too many files in the archive");

  const entries = new Map<string, { method: number; size: number; csize: number; offset: number }>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== 0x02014b50) throw new Error("damaged zip file");
    const method = b.readUInt16LE(p + 10), csize = b.readUInt32LE(p + 20), size = b.readUInt32LE(p + 24);
    const nameLen = b.readUInt16LE(p + 28), extra = b.readUInt16LE(p + 30), comment = b.readUInt16LE(p + 32);
    const offset = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    entries.set(name, { method, size, csize, offset });
    p += 46 + nameLen + extra + comment;
  }

  let total = 0;
  return {
    names: [...entries.keys()],
    read(name) {
      const e = entries.get(name);
      if (!e) return null;
      if (e.offset + 30 > b.length || b.readUInt32LE(e.offset) !== 0x04034b50) throw new Error("damaged zip file");
      const start = e.offset + 30 + b.readUInt16LE(e.offset + 26) + b.readUInt16LE(e.offset + 28);
      const data = b.subarray(start, start + e.csize);
      const left = MAX_TOTAL - total;
      if (left <= 0) throw new Error("the file expands to more than 40 MB");
      let out: Buffer;
      if (e.method === 0) out = Buffer.from(data);
      else if (e.method === 8) out = inflateRawSync(data, { maxOutputLength: left });
      else throw new Error("unsupported compression");
      total += out.length;
      return out.toString("utf8");
    },
  };
}
