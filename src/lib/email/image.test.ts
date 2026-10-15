import { describe, expect, it } from "vitest";
import { sniffImage } from "./image";

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

describe("sniffImage", () => {
  it("detects PNG with size", () => {
    const png = bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], "IHDR", [0, 0, 4, 0xb0, 0, 0, 1, 0x90], [8, 6, 0, 0, 0]);
    expect(sniffImage(png)).toEqual({ contentType: "image/png", width: 1200, height: 400 });
  });
  it("detects GIF with size", () => {
    expect(sniffImage(bytes("GIF89a", [0x58, 0x02, 0xc8, 0x00], [0, 0, 0]))).toEqual({ contentType: "image/gif", width: 600, height: 200 });
  });
  it("detects JPEG and reads the SOF segment", () => {
    const jpg = bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00], [0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x02, 0x58, 0x03], new Array(20).fill(0));
    expect(sniffImage(jpg)).toEqual({ contentType: "image/jpeg", width: 600, height: 300 });
  });
  it("detects WebP (VP8X)", () => {
    const webp = bytes("RIFF", [0, 0, 0, 0], "WEBP", "VP8X", [10, 0, 0, 0], [0, 0, 0, 0], [0x57, 0x02, 0x00], [0xc7, 0x00, 0x00]);
    expect(sniffImage(webp)).toEqual({ contentType: "image/webp", width: 600, height: 200 });
  });
  it("rejects SVG, HTML and other files whatever their name or claimed type", () => {
    expect(sniffImage(bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(sniffImage(bytes("<!doctype html><html>"))).toBeNull();
    expect(sniffImage(bytes("%PDF-1.7"))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
});
