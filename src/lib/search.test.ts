import { describe, expect, it } from "vitest";
import { searchTerm } from "./search";

describe("searchTerm", () => {
  it("removes PostgREST filter syntax", () => {
    expect(searchTerm("a,b.or(id.eq.1)")).toBe("a b.or id.eq.1");
    expect(searchTerm("riya@example.com")).toBe("riya@example.com");
    expect(searchTerm("50%*")).toBe("50");
  });
  it("trims, collapses and caps length", () => {
    expect(searchTerm("  riya   sharma ")).toBe("riya sharma");
    expect(searchTerm("x".repeat(200))).toHaveLength(80);
  });
  it("ignores non-strings", () => {
    expect(searchTerm(["a"])).toBe("");
    expect(searchTerm(undefined)).toBe("");
  });
});
