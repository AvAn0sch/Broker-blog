import { describe, expect, it } from "vitest";
import { AppError } from "../../src/contracts/errors";
import { assertStorageKey, assertUploadSize, inspectImage, storageKeyFor } from "../../src/infrastructure/storage/media-store";
import { mediaPolicy } from "../../src/modules/media/policy";
import { gifBytes, htmlBytes, paddedPng, pngBytes, svgBytes, truncatedPng } from "../fixtures/images";

const OWNER = "11111111-1111-4111-8111-111111111111";
const MEDIA = "22222222-2222-4222-8222-222222222222";

function codeOf(work: () => unknown) {
  try { work(); return null; } catch (error) { return error instanceof AppError ? error.code : "unknown"; }
}

describe("B1 media rules", () => {
  it("reads real dimensions from a generated PNG", () => {
    expect(inspectImage(pngBytes(8, 6))).toMatchObject({ mime: "image/png", extension: "png", width: 8, height: 6 });
    expect(inspectImage(pngBytes(10, 4))).toMatchObject({ width: 10, height: 4 });
  });

  it("keeps the padded boundary fixture a real image", () => {
    const padded = paddedPng(4096);
    expect(padded.length).toBe(4096);
    expect(inspectImage(padded)).toMatchObject({ mime: "image/png", width: 8, height: 6 });
  });

  it("rejects renamed, unsupported, empty and truncated files", () => {
    for (const bytes of [Buffer.alloc(0), Buffer.alloc(20), htmlBytes, svgBytes, gifBytes, truncatedPng()]) expect(inspectImage(bytes)).toBeNull();
  });

  it("fixes the 5 MiB byte boundary", () => {
    expect(mediaPolicy.maxBytes).toBe(5 * 1024 * 1024);
    expect(codeOf(() => assertUploadSize(mediaPolicy.maxBytes, mediaPolicy.maxBytes))).toBeNull();
    expect(codeOf(() => assertUploadSize(1, mediaPolicy.maxBytes))).toBeNull();
    expect(codeOf(() => assertUploadSize(mediaPolicy.maxBytes + 1, mediaPolicy.maxBytes))).toBe("MEDIA_TOO_LARGE");
    expect(codeOf(() => assertUploadSize(0, mediaPolicy.maxBytes))).toBe("MEDIA_EMPTY");
  });

  it("builds server-side storage keys and refuses anything path-like", () => {
    const key = storageKeyFor(OWNER, MEDIA, "png");
    expect(key).toBe(`${OWNER}/${MEDIA}.png`);
    expect(assertStorageKey(key)).toBe(key);
    const invalid = ["../../etc/passwd", "/etc/passwd", "C:\\Windows\\system.ini", `${OWNER}/../${MEDIA}.png`, `${OWNER}/${MEDIA}.svg`, `${OWNER}/${MEDIA}.png/../x.png`, "not-a-uuid/key.png", `${OWNER}/${MEDIA}`, `${OWNER}/${MEDIA}.png.partial`];
    for (const value of invalid) expect(codeOf(() => assertStorageKey(value))).toBe("INVALID_MEDIA_KEY");
  });
});
