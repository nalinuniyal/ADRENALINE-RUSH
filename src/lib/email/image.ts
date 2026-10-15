/**
 * Identifies an uploaded image from its bytes (magic numbers), never from the
 * browser-supplied MIME type or file name, and reads its pixel size.
 * Only PNG, JPEG, GIF and WebP are accepted (no SVG: it can carry scripts).
 */

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export type SniffedImage = { contentType: ImageType; width: number | null; height: number | null };

const ascii = (b: Uint8Array, start: number, len: number) => String.fromCharCode(...b.subarray(start, start + len));
const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);

function dims(w: number, h: number): { width: number | null; height: number | null } {
  const ok = (n: number) => Number.isInteger(n) && n >= 1 && n <= 20000;
  return ok(w) && ok(h) ? { width: w, height: h } : { width: null, height: null };
}

function jpegSize(b: Uint8Array): { width: number | null; height: number | null } {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = u16be(b, i + 2);
    // SOF0-SOF15 except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return dims(u16be(b, i + 7), u16be(b, i + 5));
    }
    if (len < 2) break;
    i += 2 + len;
  }
  return { width: null, height: null };
}

function webpSize(b: Uint8Array): { width: number | null; height: number | null } {
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8X" && b.length >= 30) return dims(u24le(b, 24) + 1, u24le(b, 27) + 1);
  if (chunk === "VP8L" && b.length >= 25 && b[20] === 0x2f) {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return dims((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
  }
  if (chunk === "VP8 " && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
    return dims(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
  }
  return { width: null, height: null };
}

export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  const b = bytes;
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return { contentType: "image/png", ...(ascii(b, 12, 4) === "IHDR" ? dims(u32be(b, 16), u32be(b, 20)) : { width: null, height: null }) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { contentType: "image/jpeg", ...jpegSize(b) };
  }
  if (b.length >= 10 && (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a")) {
    return { contentType: "image/gif", ...dims(u16le(b, 6), u16le(b, 8)) };
  }
  if (b.length >= 16 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") {
    return { contentType: "image/webp", ...webpSize(b) };
  }
  return null;
}
