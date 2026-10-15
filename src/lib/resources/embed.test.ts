import { describe, expect, it } from "vitest";
import { autoThumbnail, embedFor, linkHost } from "./embed";

describe("embedFor", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"],
    ["https://youtube.com/watch?v=dQw4w9WgXcQ&list=x", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?t=90", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90"],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"],
    ["https://www.youtube.com/live/dQw4w9WgXcQ", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"],
    ["https://vimeo.com/76979871", "https://player.vimeo.com/video/76979871"],
    ["https://vimeo.com/76979871/8a2b3c4d5e", "https://player.vimeo.com/video/76979871?h=8a2b3c4d5e"],
    ["https://vimeo.com/channels/staffpicks/76979871", "https://player.vimeo.com/video/76979871"],
    ["https://player.vimeo.com/video/76979871?h=abc123", "https://player.vimeo.com/video/76979871?h=abc123"],
    ["https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view?usp=sharing", "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/preview"],
    ["https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz012345", "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/preview"],
    ["https://www.loom.com/share/0123456789abcdef0123456789abcdef", "https://www.loom.com/embed/0123456789abcdef0123456789abcdef"],
  ])("embeds %s", (url, src) => {
    expect(embedFor(url)?.src).toBe(src);
  });

  it.each([
    "http://www.youtube.com/watch?v=dQw4w9WgXcQ", // not https
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ\"><script>",
    "https://evil.example/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    "https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/channel/UC123",
    "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz012345",
    "https://docs.google.com/document/d/abc/edit",
    "https://vimeo.com/about",
    "javascript:alert(1)",
    "not a url",
    "",
  ])("does not embed %s", (url) => {
    expect(embedFor(url)).toBeNull();
  });

  it("handles null and undefined", () => {
    expect(embedFor(null)).toBeNull();
    expect(embedFor(undefined)).toBeNull();
  });
});

describe("linkHost and autoThumbnail", () => {
  it("shows a short host and a YouTube thumbnail", () => {
    expect(linkHost("https://www.github.com/org/repo")).toBe("github.com");
    expect(linkHost("ftp://x")).toBeNull();
    expect(autoThumbnail("https://youtu.be/dQw4w9WgXcQ")).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
    expect(autoThumbnail("https://vimeo.com/76979871")).toBeNull();
  });
});
