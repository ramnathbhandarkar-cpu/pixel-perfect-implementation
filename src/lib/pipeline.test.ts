import { describe, expect, it } from "bun:test";
import { parseCandleCsv } from "./pipeline";

const HEAD = "timestamp,open,high,low,close,volume";

describe("parseCandleCsv", () => {
  it("parses well-formed rows", () => {
    const { rows, skipped } = parseCandleCsv(
      `${HEAD}\n2026-07-20T09:15:00+05:30,100,105,99,104,12000`,
      "RELIANCE",
      "1d",
    );
    expect(skipped).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].symbol).toBe("RELIANCE");
    expect(rows[0].timeframe).toBe("1d");
    expect(rows[0].open).toBe(100);
    expect(rows[0].close).toBe(104);
    expect(rows[0].volume).toBe(12000);
    expect(rows[0].ts).toBe(new Date("2026-07-20T09:15:00+05:30").toISOString());
  });

  it("accepts alternative timestamp headers and missing volume", () => {
    const { rows } = parseCandleCsv(
      "date,open,high,low,close\n2026-07-20,10,11,9,10.5",
      "ITC",
      "1d",
    );
    expect(rows[0].volume).toBeNull();
  });

  it("drops malformed rows and counts them rather than coercing to zero", () => {
    const csv = [
      HEAD,
      "2026-07-20,100,105,99,104,1000",
      "not-a-date,100,105,99,104,1000",
      "2026-07-21,,105,99,104,1000",
      "2026-07-22,101,106,100,105,2000",
    ].join("\n");
    const { rows, skipped } = parseCandleCsv(csv, "TCS", "1d");
    expect(rows).toHaveLength(2);
    expect(skipped).toBe(2);
    expect(rows.every((r) => Number.isFinite(r.open) && r.open > 0)).toBe(true);
  });

  it("rejects a CSV missing required columns", () => {
    expect(() => parseCandleCsv("date,open,close\n2026-07-20,1,2", "X", "1d")).toThrow();
  });

  it("rejects a CSV with a header but no usable rows", () => {
    expect(() => parseCandleCsv(`${HEAD}\nbad,bad,bad,bad,bad,bad`, "X", "1d")).toThrow();
  });

  it("rejects an empty CSV", () => {
    expect(() => parseCandleCsv("", "X", "1d")).toThrow();
  });
});
