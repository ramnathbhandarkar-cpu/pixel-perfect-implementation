import { describe, expect, it } from "bun:test";
import { bollinger, ema, macd, rsi, sma, vwap } from "./indicators";

describe("sma", () => {
  it("is null during warm-up and correct after", () => {
    const out = sma([1, 2, 3, 4, 5], 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBeCloseTo(2, 10);
    expect(out[4]).toBeCloseTo(4, 10);
  });
});

describe("ema", () => {
  it("seeds with an SMA then smooths", () => {
    const out = ema([1, 2, 3, 4, 5], 3);
    expect(out[1]).toBeNull();
    expect(out[2]).toBeCloseTo(2, 10); // seed = SMA(1,2,3)
    // k = 2/(3+1) = 0.5 → 4*0.5 + 2*0.5 = 3
    expect(out[3]).toBeCloseTo(3, 10);
  });
});

describe("rsi (Wilder)", () => {
  it("returns 100 when every bar gains", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    const out = rsi(closes, 14);
    expect(out[13]).toBeNull(); // still warming up at index < period
    expect(out[14]).toBeCloseTo(100, 6);
  });

  it("hovers around 50 for a perfectly alternating series", () => {
    // Equal average gain and loss → RS ≈ 1. Wilder smoothing makes it
    // oscillate a couple of points either side of 50 rather than pin to it.
    const closes: number[] = [100];
    for (let i = 1; i < 60; i++) closes.push(i % 2 === 1 ? 101 : 100);
    const out = rsi(closes, 14);
    expect(out[14]).toBeCloseTo(50, 6); // exact at the seed bar
    expect(Math.abs((out[59] as number) - 50)).toBeLessThan(3);
  });

  it("returns 0 when every bar loses", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 200 - i);
    const out = rsi(closes, 14);
    expect(out[14]).toBeCloseTo(0, 6);
  });

  it("returns 50 for a completely flat series", () => {
    const out = rsi(new Array(30).fill(100), 14);
    expect(out[14]).toBeCloseTo(50, 6);
  });

  it("stays within 0..100 and warms up exactly at `period`", () => {
    const closes = [
      44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61,
      46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64,
    ];
    const out = rsi(closes, 14);
    expect(out[13]).toBeNull();
    expect(out[14]).not.toBeNull();
    // Classic Wilder worked example lands near 70 on this series.
    expect(out[14] as number).toBeGreaterThan(65);
    expect(out[14] as number).toBeLessThan(75);
    for (const v of out) {
      if (v != null) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("bollinger", () => {
  it("brackets the mid band symmetrically", () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i) * 2);
    const bb = bollinger(closes, 20, 2);
    const i = 39;
    expect(bb.mid[i]).not.toBeNull();
    expect(bb.upper[i]! - bb.mid[i]!).toBeCloseTo(bb.mid[i]! - bb.lower[i]!, 8);
  });

  it("collapses to the mean when the series is flat", () => {
    const bb = bollinger(new Array(25).fill(50), 20, 2);
    expect(bb.upper[24]).toBeCloseTo(50, 10);
    expect(bb.lower[24]).toBeCloseTo(50, 10);
  });
});

describe("macd", () => {
  it("is positive while price trends up", () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 + i);
    const m = macd(closes, 12, 26, 9);
    expect(m.macd[79]).not.toBeNull();
    expect(m.macd[79] as number).toBeGreaterThan(0);
    expect(m.hist[79]).not.toBeNull();
  });
});

describe("vwap", () => {
  it("resets each trading day", () => {
    const day1 = Number(new Date("2026-07-20T04:00:00Z")) / 1000;
    const day2 = Number(new Date("2026-07-21T04:00:00Z")) / 1000;
    const out = vwap([
      { time: day1, open: 10, high: 10, low: 10, close: 10, volume: 100 },
      { time: day1 + 900, open: 20, high: 20, low: 20, close: 20, volume: 100 },
      // New day → the running total starts over rather than carrying yesterday.
      { time: day2, open: 50, high: 50, low: 50, close: 50, volume: 100 },
    ]);
    expect(out[1]).toBeCloseTo(15, 6);
    expect(out[2]).toBeCloseTo(50, 6);
  });

  it("returns null when there is no volume to weight by", () => {
    const t = Number(new Date("2026-07-20T04:00:00Z")) / 1000;
    const out = vwap([{ time: t, open: 10, high: 10, low: 10, close: 10, volume: 0 }]);
    expect(out[0]).toBeNull();
  });
});
