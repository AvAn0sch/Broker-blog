import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, realpath, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { AppError } from "../../contracts/errors";

export type MimeType = "image/jpeg" | "image/png" | "image/webp";
export type ImageInfo = { mime: MimeType; extension: string; width: number; height: number };
/** One-shot fault points used by the isolated test run; production passes nothing. */
export type Faults = { hit(point: string): void };

const EXTENSIONS: Record<MimeType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;
const MAX_DIMENSION = 20000;

export function checksumOf(bytes: Buffer) { return createHash("sha256").update(bytes).digest("hex"); }

/** The 5 MiB byte boundary is fixed in B1 and covered by boundary tests. */
export function assertUploadSize(size: number, maxBytes: number) {
  if (!Number.isInteger(size) || size <= 0) throw new AppError("MEDIA_EMPTY", 400, "上传内容为空。");
  if (size > maxBytes) throw new AppError("MEDIA_TOO_LARGE", 413, `单张图片不能超过 ${Math.floor(maxBytes / 1048576)} MB。`);
}

/** Server-generated storage key: owner and media IDs only, never a client path. */
export function storageKeyFor(ownerId: string, mediaId: string, extension: string) { return `${ownerId}/${mediaId}.${extension}`; }

/** Only server-generated keys denote media objects; unrelated files in the root are left alone. */
export function isStorageKey(key: string) { return KEY_PATTERN.test(key); }

export function assertStorageKey(key: string) {
  if (!isStorageKey(key)) throw new AppError("INVALID_MEDIA_KEY", 400, "媒体存储键无效。");
  return key;
}

function pngInfo(bytes: Buffer): ImageInfo | null {
  if (bytes.length < 45 || bytes.readUInt32BE(8) !== 13 || bytes.subarray(12, 16).toString("latin1") !== "IHDR") return null;
  const width = bytes.readUInt32BE(16); const height = bytes.readUInt32BE(20);
  if (bytes.readUInt32BE(bytes.length - 12) !== 0 || bytes.subarray(bytes.length - 8, bytes.length - 4).toString("latin1") !== "IEND") return null;
  if (!bytes.includes("IDAT")) return null;
  return dimensions("image/png", width, height);
}

function jpegInfo(bytes: Buffer): ImageInfo | null {
  if (bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) return null;
  let offset = 2; let width = 0; let height = 0;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xff) { offset += 1; continue; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { offset += 2; continue; }
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) return null;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (offset + 9 > bytes.length) return null;
      height = bytes.readUInt16BE(offset + 5); width = bytes.readUInt16BE(offset + 7);
      break;
    }
    if (marker === 0xda) break;
    offset += 2 + length;
  }
  return dimensions("image/jpeg", width, height);
}

function webpInfo(bytes: Buffer): ImageInfo | null {
  if (bytes.length < 25 || bytes.subarray(0, 4).toString("latin1") !== "RIFF" || bytes.subarray(8, 12).toString("latin1") !== "WEBP") return null;
  if (bytes.readUInt32LE(4) + 8 !== bytes.length) return null;
  const chunk = bytes.subarray(12, 16).toString("latin1");
  const chunkSize = bytes.readUInt32LE(16);
  if (chunkSize === 0 || 20 + chunkSize > bytes.length) return null;
  if (chunk === "VP8X") { if (bytes.length < 30) return null; return dimensions("image/webp", 1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3)); }
  if (chunk === "VP8L") {
    if (bytes.length < 25 || bytes[20] !== 0x2f) return null;
    return dimensions("image/webp", 1 + (((bytes[22] & 0x3f) << 8) | bytes[21]), 1 + (((bytes[24] & 0x0f) << 10) | (bytes[23] << 2) | ((bytes[22] & 0xc0) >> 6)));
  }
  if (chunk === "VP8 ") {
    if (bytes.length < 30 || bytes.readUIntLE(23, 3) !== 0x2a019d) return null;
    return dimensions("image/webp", bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff);
  }
  return null;
}

function dimensions(mime: MimeType, width: number, height: number): ImageInfo | null {
  if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION) return null;
  return { mime, extension: EXTENSIONS[mime], width, height };
}

/**
 * Structural validation of the real image type: signature, declared dimensions and
 * container termination. This rejects renamed or truncated files without a decoder;
 * full pixel decoding is not part of B1.
 */
export function inspectImage(bytes: Buffer): ImageInfo | null {
  if (bytes.length < 16) return null;
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return pngInfo(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegInfo(bytes);
  return webpInfo(bytes);
}

/** Containment check: lexical root check plus realpath of the deepest existing ancestor. */
export async function resolveWithinRoot(root: string, key: string) {
  assertStorageKey(key);
  const realRoot = await realpath(root);
  const target = path.resolve(realRoot, key);
  const relative = path.relative(realRoot, target);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) throw new AppError("INVALID_MEDIA_KEY", 400, "媒体存储键越界。");
  let existing = path.dirname(target);
  while (true) {
    try {
      const real = await realpath(existing);
      const inside = path.relative(realRoot, real);
      if (inside.startsWith("..") || path.isAbsolute(inside)) throw new AppError("INVALID_MEDIA_KEY", 400, "媒体存储键越界。");
      break;
    } catch (error) {
      if (error instanceof AppError) throw error;
      const parent = path.dirname(existing);
      if (parent === existing) break;
      existing = parent;
    }
  }
  return target;
}

/** Writes land under the run media root only; rename is atomic inside one filesystem. */
export function mediaStore(options: { root: string; faults?: Faults }) {
  const { root, faults } = options;
  async function target(key: string) { return resolveWithinRoot(root, key); }
  async function partial(key: string) { return `${await target(key)}.partial`; }
  async function stage(key: string, bytes: Buffer) {
    faults?.hit("media.write");
    const final = await target(key); const temporary = `${final}.partial`;
    await mkdir(path.dirname(final), { recursive: true });
    const handle = await open(temporary, "w");
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    return { temporary, final };
  }
  async function commit(temporary: string, final: string) { faults?.hit("media.commit"); await rename(temporary, final); }
  async function read(key: string) {
    faults?.hit("media.read");
    // Resolve first: a containment violation must stay INVALID_MEDIA_KEY, never a generic failure.
    const resolved = await target(key);
    try { return await readFile(resolved); }
    catch { throw new AppError("MEDIA_UNAVAILABLE", 503, "图片暂时无法读取，请稍后重试。"); }
  }
  /** Reports whether the final file (or a leftover partial) is a complete image. */
  async function verify(key: string): Promise<{ checksum: string; size: number; mime: MimeType; partial: boolean } | null> {
    const final = await target(key);
    for (const [candidate, isPartial] of [[final, false], [`${final}.partial`, true]] as const) {
      try {
        const bytes = await readFile(candidate);
        const image = inspectImage(bytes);
        if (image) return { checksum: checksumOf(bytes), size: bytes.length, mime: image.mime, partial: isPartial };
      } catch { /* try the next candidate */ }
    }
    return null;
  }
  async function promote(key: string) { const final = await target(key); await commit(`${final}.partial`, final); }
  async function remove(key: string) {
    const final = await target(key);
    await rm(final, { force: true });
    await rm(`${final}.partial`, { force: true });
  }
  async function list(limit: number) {
    const found: { key: string; size: number; mtimeMs: number }[] = [];
    async function walk(directory: string) {
      if (found.length >= limit) return;
      let entries; try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (found.length >= limit) return;
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) { await walk(full); continue; }
        if (!entry.isFile()) continue;
        const info = await stat(full);
        found.push({ key: path.relative(root, full).split(path.sep).join("/"), size: info.size, mtimeMs: info.mtimeMs });
      }
    }
    await walk(root);
    return found;
  }
  return { stage, commit, read, verify, promote, remove, list, target };
}
