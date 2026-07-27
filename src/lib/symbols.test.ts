import { describe, expect, it } from "bun:test";
import { normaliseSymbol } from "./symbols";

describe("normaliseSymbol", () => {
  it("uppercases and trims", () => {
    expect(normaliseSymbol("  reliance ")).toBe("RELIANCE");
  });

  it("strips an NSE: prefix", () => {
    expect(normaliseSymbol("nse:itc")).toBe("ITC");
    expect(normaliseSymbol("NSE:TCS")).toBe("TCS");
  });

  it("strips a .NS suffix", () => {
    expect(normaliseSymbol("INFY.NS")).toBe("INFY");
    expect(normaliseSymbol("infy.ns")).toBe("INFY");
  });

  it("removes internal whitespace", () => {
    expect(normaliseSymbol("HDFC BANK")).toBe("HDFCBANK");
  });

  it("handles both prefix and suffix together", () => {
    expect(normaliseSymbol(" nse:mazdock.ns ")).toBe("MAZDOCK");
  });

  it("returns empty for empty input", () => {
    expect(normaliseSymbol("   ")).toBe("");
  });
});
