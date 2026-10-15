import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return table;
})();

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer) {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A genuinely valid 8-bit RGB PNG generated without external tools. */
export function pngBytes(width = 8, height = 6) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const stride = 1 + width * 3;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const row = y * stride; raw[row] = 0;
    for (let x = 0; x < width; x++) { const pixel = row + 1 + x * 3; raw[pixel] = 34; raw[pixel + 1] = 119; raw[pixel + 2] = 93; }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** Same signature as a PNG but without the terminating chunk: a forged or truncated file. */
export function truncatedPng() { const bytes = pngBytes(); return bytes.subarray(0, bytes.length - 12); }

export const svgBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="6"><rect width="8" height="6"/></svg>', "utf8");
export const htmlBytes = Buffer.from("<!doctype html><html><body>not an image</body></html>", "utf8");
export const gifBytes = Buffer.from("GIF89a\u0008\u0000\u0006\u0000\u0000\u0000\u0000;", "latin1");

/** Pads a valid image past the byte limit while keeping it a real image. */
export function paddedPng(bytes: number) {
  const image = pngBytes();
  const filler = chunk("tEXt", Buffer.alloc(Math.max(0, bytes - image.length - 12), 0x20));
  return Buffer.concat([image.subarray(0, image.length - 12), filler, image.subarray(image.length - 12)]);
}
