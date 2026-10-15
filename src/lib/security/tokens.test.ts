import { describe, expect, it } from "vitest";
import { hashKey, safeEqual } from "./tokens";

describe("safeEqual", () => {
  it("compares exactly", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});

describe("hashKey", () => {
  it("never contains the raw identifier and normalises case", () => {
    const k = hashKey("login-email", "Person@Example.test", "salt");
    expect(k).not.toContain("person");
    expect(k).toBe(hashKey("login-email", "person@example.test ", "salt"));
    expect(k).not.toBe(hashKey("login-email", "person@example.test", "other-salt"));
  });
});
