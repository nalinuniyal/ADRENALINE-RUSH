import { describe, expect, it } from "vitest";
import { csvCell, parseCsv, toCsv } from "./csv";

describe("csv", () => {
  it("escapes quotes, commas and newlines", () => {
    expect(csvCell('He said "hi", ok')).toBe('"He said ""hi"", ok"');
    expect(csvCell("a\nb")).toBe('"a\nb"');
  });
  it("neutralises spreadsheet formulas but keeps negative numbers", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("-12.5")).toBe("-12.5");
  });
  it("round-trips through the parser", () => {
    const text = toCsv(["name", "note"], [["Asha", 'Line1\n"quoted", x'], ["Ravi", ""]]);
    expect(parseCsv(text)).toEqual([["name", "note"], ["Asha", 'Line1\n"quoted", x'], ["Ravi", ""]]);
  });
  it("handles BOM, CRLF and blank lines", () => {
    expect(parseCsv("﻿a,b\r\n1,2\r\n\r\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
});
