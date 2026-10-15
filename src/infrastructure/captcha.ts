import { randomInt } from "node:crypto";
import { deflateSync } from "node:zlib";

// Five by seven raster glyphs. Only pixels are returned; no SVG text or PNG text chunks.
const glyphs: Record<string, number[]> = {
  A:[14,17,17,31,17,17,17], B:[30,17,17,30,17,17,30], C:[14,17,16,16,16,17,14],
  D:[30,17,17,17,17,17,30], E:[31,16,16,30,16,16,31], F:[31,16,16,30,16,16,16],
  G:[14,17,16,23,17,17,15], H:[17,17,17,31,17,17,17], J:[7,2,2,2,18,18,12],
  K:[17,18,20,24,20,18,17], L:[16,16,16,16,16,16,31], M:[17,27,21,21,17,17,17],
  N:[17,25,21,19,17,17,17], P:[30,17,17,30,16,16,16], R:[30,17,17,30,20,18,17],
  S:[15,16,16,14,1,1,30], T:[31,4,4,4,4,4,4], U:[17,17,17,17,17,17,14],
  V:[17,17,17,17,17,10,4], W:[17,17,17,21,21,27,17], X:[17,17,10,4,10,17,17],
  Y:[17,17,10,4,4,4,4], Z:[31,1,2,4,8,16,31],
  "2":[14,17,1,2,4,8,31], "3":[30,1,1,14,1,1,30], "4":[2,6,10,18,31,2,2],
  "5":[31,16,16,30,1,1,30], "6":[14,16,16,30,17,17,14], "7":[31,1,2,4,8,8,8],
  "8":[14,17,17,14,17,17,14], "9":[14,17,17,15,1,1,14],
};
function chunk(type: string, data: Buffer) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, body, checksum]);
}

export function generateCaptcha() {
  const alphabet = Object.keys(glyphs);
  const answer = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("");
  const width = 228, height = 64;
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  function dot(x: number, y: number, shade: number) {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const offset = y * (width * 3 + 1) + 1 + x * 3;
    pixels[offset] = shade; pixels[offset + 1] = Math.min(255, shade + 12); pixels[offset + 2] = shade;
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) dot(x, y, randomInt(233, 244));
  for (let i = 0; i < 350; i++) dot(randomInt(width), randomInt(height), randomInt(120, 220));
  for (let i = 0; i < answer.length; i++) {
    const top = randomInt(10, 23), left = 12 + i * 35, shade = randomInt(35, 85), skew = randomInt(-2, 3);
    glyphs[answer[i]].forEach((row, y) => {
      for (let x = 0; x < 5; x++) if (row & (1 << (4 - x))) {
        for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) dot(left + x * 4 + dx + Math.round(y * skew / 7), top + y * 4 + dy, shade);
      }
    });
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
  return { answer, image: `data:image/png;base64,${png.toString("base64")}` };
}
