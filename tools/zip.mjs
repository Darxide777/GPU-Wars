// A small zip writer and reader (no dependencies): enough for the itch.io upload. Entries are deflated when that makes them smaller, otherwise stored. Names use forward slashes.
import zlib from 'node:zlib';

const TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = TABLE[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** files: [{ name, data: Buffer }] -> a zip file as a Buffer. The date is fixed so the same files give the same zip. */
export function buildZip(files) {
  const parts = [], central = []; let offset = 0;
  const DOS_TIME = 0, DOS_DATE = (46 << 9) | (1 << 5) | 1;      // 2026-01-01 00:00
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8'), raw = Buffer.from(f.data), packed = zlib.deflateRawSync(raw, { level: 9 }), useDeflate = packed.length < raw.length, body = useDeflate ? packed : raw, method = useDeflate ? 8 : 0, crc = crc32(raw);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(method, 8); local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, name, body);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(method, 10); c.writeUInt16LE(DOS_TIME, 12); c.writeUInt16LE(DOS_DATE, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, name); offset += 30 + name.length + body.length;
  }
  const dir = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}
/** a zip Buffer -> [{ name, data, size }], checking each entry's crc */
export function readZip(zip) {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])); if (end < 0) throw new Error('not a zip');
  const count = zip.readUInt16LE(end + 10); let at = zip.readUInt32LE(end + 16); const out = [];
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error('bad central directory');
    const method = zip.readUInt16LE(at + 10), crc = zip.readUInt32LE(at + 16), csize = zip.readUInt32LE(at + 20), size = zip.readUInt32LE(at + 24), nlen = zip.readUInt16LE(at + 28), elen = zip.readUInt16LE(at + 30), clen = zip.readUInt16LE(at + 32), lo = zip.readUInt32LE(at + 42);
    const name = zip.toString('utf8', at + 46, at + 46 + nlen), start = lo + 30 + zip.readUInt16LE(lo + 26) + zip.readUInt16LE(lo + 28), body = zip.subarray(start, start + csize);
    const data = method === 8 ? zlib.inflateRawSync(body) : body; if (data.length !== size || crc32(data) !== crc) throw new Error('bad entry ' + name);
    out.push({ name, data, size }); at += 46 + nlen + elen + clen;
  }
  return out;
}
