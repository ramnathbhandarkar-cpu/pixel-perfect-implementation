import { describe, expect, it } from "bun:test";
import {
  classifyTrend,
  clusterPivots,
  computeLevels,
  findSwingPivots,
  type DailyCandle,
  type Pivot,
} from "./levels-engine";

function candlesFromCloses(closes: number[]): DailyCandle[] {
  return closes.map((c, i) => ({
    time: 1_700_000_000 + i * 86_400,
    open: c,
    high: c + 1,
    low: c - 1,
    close: c,
    volume: 1000,
  }));
}

function pivot(price: number): Pivot {
  return { index: 0, price, kind: "low" };
}

describe("swing pivots (window = 5 either side)", () => {
  it("finds the trough of a V as a swing low", () => {
    // 11 bars, trough at index 5 — the only index with a full ±5 window.
    const v = candlesFromCloses([110, 108, 106, 104, 102, 100, 102, 104, 106, 108, 110]);
    const pivots = findSwingPivots(v);
    expect(pivots).toHaveLength(1);
    expect(pivots[0].kind).toBe("low");
    expect(pivots[0].index).toBe(5);
    expect(pivots[0].price).toBe(99); // low = close − 1
  });

  it("returns nothing when there is no full window", () => {
    expect(findSwingPivots(candlesFromCloses([1, 2, 3]))).toHaveLength(0);
  });
});

describe("pivot clustering (1.5% of running mean)", () => {
  it("merges nearby pivots and counts them as tests", () => {
    const clusters = clusterPivots([pivot(100), pivot(100.5), pivot(101), pivot(110)]);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].tests).toBe(3);
    expect(clusters[0].price).toBeCloseTo((100 + 100.5 + 101) / 3, 6);
    expect(clusters[1].tests).toBe(1);
    expect(clusters[1].price).toBe(110);
  });

  it("keeps pivots farther than 1.5% apart in separate clusters", () => {
    const clusters = clusterPivots([pivot(100), pivot(102)]);
    expect(clusters).toHaveLength(2);
  });
});

describe("trend classification — MA_SLOPE_PCT = 1.0 bug fix", () => {
  it("classifies a flat base as range / base, NOT downtrend, even with price below MA50", () => {
    // In a sideways range price spends half its time below a flat MA50.
    // Without the slope threshold this was misclassified as a downtrend.
    const closes = Array.from({ length: 250 }, (_, i) => (i % 2 === 0 ? 100.3 : 99.7));
    // last close 99.7 < flat MA50 ≈ 100, slope ≈ 0
    const t = classifyTrend(closes);
    expect(t.trendContext).toBe("range / base");
    expect(t.isDowntrend).toBe(false);
  });

  it("classifies a genuine decline as DOWNTREND", () => {
    const closes = Array.from({ length: 250 }, (_, i) => 300 - 0.5 * i);
    const t = classifyTrend(closes);
    expect(t.trendContext).toBe("DOWNTREND");
    expect(t.isDowntrend).toBe(true);
  });

  it("classifies a steady rise as uptrend", () => {
    const closes = Array.from({ length: 250 }, (_, i) => 100 + 0.5 * i);
    const t = classifyTrend(closes);
    expect(t.trendContext).toBe("uptrend");
    expect(t.isDowntrend).toBe(false);
  });

  it("classifies price below a falling MA50 (without MA200 confirmation) as weak / rolling over", () => {
    // 100 bars only — no MA200 available. Rise to a peak, then roll over.
    const closes = Array.from({ length: 100 }, (_, i) =>
      i <= 40 ? 100 + 0.5 * i : 120 - 0.4 * (i - 40),
    );
    const t = classifyTrend(closes);
    expect(t.trendContext).toBe("weak / rolling over");
    expect(t.isDowntrend).toBe(true);
  });

  it("defaults to range / base when history is too short to judge", () => {
    const t = classifyTrend(Array.from({ length: 69 }, () => 100));
    expect(t.trendContext).toBe("range / base");
    expect(t.isDowntrend).toBe(false);
  });
});

describe("computeLevels — full pipeline on a flat base", () => {
  it("finds tested support below and resistance above the last close", () => {
    // Sawtooth between 95 and 115, period 20 → repeated tested floor/ceiling.
    const closes = Array.from({ length: 245 }, (_, i) => {
      const pos = i % 20;
      return pos <= 10 ? 95 + 2 * pos : 95 + 2 * (20 - pos);
    });
    const result = computeLevels(candlesFromCloses(closes))!;
    expect(result).toBeTruthy();
    const price = closes[closes.length - 1];
    expect(result.support).toBeLessThan(price);
    expect(result.resistance).toBeGreaterThan(price);
    expect(result.supportTests).toBeGreaterThanOrEqual(2);
    expect(result.resistanceTests).toBeGreaterThanOrEqual(2);
    // A flat oscillating base must not read as a downtrend.
    expect(result.trendContext).toBe("range / base");
    expect(result.isDowntrend).toBe(false);
  });

  it("returns null when fewer than 60 bars exist", () => {
    const result = computeLevels(candlesFromCloses(Array(59).fill(100)));
    expect(result).toBeNull();
  });
});
