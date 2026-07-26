import { describe, expect, it } from "bun:test";
import {
  evaluateSetup,
  rankingScore,
  runScreener,
  sectorClusters,
  type ScreenerInput,
} from "./screener-engine";

// Base fixture: price 100, support 96 → risk 4 (4%, inside the 1.5–8% band).
// Resistance is derived from the desired reward:risk ratio.
function fixture(
  symbol: string,
  ratio: number,
  supportTests: number,
  isDowntrend: boolean,
  overrides: Partial<ScreenerInput> = {},
): ScreenerInput {
  return {
    symbol,
    sector: null,
    price: 100,
    support: 96,
    supportTests,
    resistance: 100 + 4 * ratio,
    resistanceTests: 2,
    trendContext: isDowntrend ? "DOWNTREND" : "range / base",
    isDowntrend,
    ...overrides,
  };
}

describe("ranking — verified behaviour from the Python tests (§6.2)", () => {
  // | SOLID-MID     | 1:2.8 | 3× | base      | 1st  |
  // | THIN-BUT-BIG  | 1:3.4 | 2× | base      | 2nd  |
  // | WELL-TESTED   | 1:2.2 | 4× | base      | 3rd  |
  // | DOWNTREND-BIG | 1:4.0 | 4× | DOWNTREND | last |
  const inputs = [
    fixture("WELL-TESTED", 2.2, 4, false),
    fixture("DOWNTREND-BIG", 4.0, 4, true),
    fixture("SOLID-MID", 2.8, 3, false),
    fixture("THIN-BUT-BIG", 3.4, 2, false),
  ];

  it("ranks SOLID-MID > THIN-BUT-BIG > WELL-TESTED > DOWNTREND-BIG", () => {
    const result = runScreener(inputs);
    expect(result.qualifying.map((q) => q.symbol)).toEqual([
      "SOLID-MID",
      "THIN-BUT-BIG",
      "WELL-TESTED",
      "DOWNTREND-BIG",
    ]);
  });

  it("puts the best raw geometry (1:4.0) last because of the downtrend penalty", () => {
    const result = runScreener(inputs);
    const last = result.qualifying[result.qualifying.length - 1];
    expect(last.symbol).toBe("DOWNTREND-BIG");
    expect(last.ratio).toBeCloseTo(4.0, 6);
  });

  it("computes the exact score formula", () => {
    // ratio × (0.45 if downtrend else 1.0) × (0.30 + 0.70 × min(tests,4)/4)
    expect(rankingScore(2.8, 3, false)).toBeCloseTo(2.8 * (0.3 + 0.7 * 0.75), 10);
    expect(rankingScore(3.4, 2, false)).toBeCloseTo(3.4 * (0.3 + 0.7 * 0.5), 10);
    expect(rankingScore(2.2, 4, false)).toBeCloseTo(2.2 * 1.0, 10);
    expect(rankingScore(4.0, 4, true)).toBeCloseTo(4.0 * 0.45, 10);
    // tests capped at 4
    expect(rankingScore(2.0, 9, false)).toBeCloseTo(rankingScore(2.0, 4, false), 10);
  });
});

describe("qualification rules", () => {
  it("accepts ratio exactly 2.0, tests exactly 2, risk% at both band edges", () => {
    expect(evaluateSetup(fixture("EDGE-RATIO", 2.0, 2, false)).qualifies).toBe(true);
    // risk exactly 1.5%: support 98.5, reward 2:1 → resistance 103
    const tight = evaluateSetup(
      fixture("EDGE-TIGHT", 2, 3, false, { support: 98.5, resistance: 103 }),
    );
    expect(tight.qualifies).toBe(true);
    // risk exactly 8%: support 92, resistance 116
    const wide = evaluateSetup(fixture("EDGE-WIDE", 2, 3, false, { support: 92, resistance: 116 }));
    expect(wide.qualifies).toBe(true);
  });

  it("rejects ratio below 2.0 as geometry", () => {
    const e = evaluateSetup(fixture("R19", 1.9, 3, false));
    expect(e.qualifies).toBe(false);
    expect(e.rejectionCategory).toBe("geometry");
  });

  it("rejects an untested floor as thin support even with good geometry", () => {
    const e = evaluateSetup(fixture("ONETOUCH", 2.5, 1, false));
    expect(e.qualifies).toBe(false);
    expect(e.rejectionCategory).toBe("thin_support");
  });

  it("rejects a stop tighter than 1.5% (stopped by noise)", () => {
    const e = evaluateSetup(fixture("TIGHT", 3, 3, false, { support: 99, resistance: 103 }));
    expect(e.qualifies).toBe(false);
    expect(e.rejectionCategory).toBe("risk_band");
  });

  it("rejects a stop wider than 8% (not a 1–2 week swing)", () => {
    const e = evaluateSetup(fixture("WIDE", 3, 3, false, { support: 91, resistance: 127 }));
    expect(e.qualifies).toBe(false);
    expect(e.rejectionCategory).toBe("risk_band");
  });

  it("rejects when no tested level exists below or above price", () => {
    const noSupport = evaluateSetup(
      fixture("NOSUP", 2, 0, false, { support: null, supportTests: 0 }),
    );
    expect(noSupport.rejectionCategory).toBe("thin_support");
    const noRes = evaluateSetup(fixture("NORES", 2, 3, false, { resistance: null }));
    expect(noRes.rejectionCategory).toBe("geometry");
  });

  it("counts rejections by category for persistence", () => {
    const result = runScreener([
      fixture("OK", 2.5, 3, false),
      fixture("THIN", 2.5, 1, false),
      fixture("GEOM", 1.5, 3, false),
      fixture("BAND", 3, 3, false, { support: 99.2, resistance: 102.4 }),
    ]);
    expect(result.qualifying).toHaveLength(1);
    expect(result.rejectedThinSupport).toBe(1);
    expect(result.rejectedGeometry).toBe(1);
    expect(result.rejectedRiskBand).toBe(1);
    expect(result.scanned).toBe(4);
  });
});

describe("sector clustering", () => {
  it("reports sectors with ≥2 qualifying setups", () => {
    const result = runScreener([
      fixture("BANK1", 2.5, 3, false, { sector: "Banking" }),
      fixture("BANK2", 2.4, 3, false, { sector: "Banking" }),
      fixture("IT1", 2.6, 3, false, { sector: "IT" }),
    ]);
    const clusters = sectorClusters(result.qualifying);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].sector).toBe("Banking");
    expect(clusters[0].symbols).toHaveLength(2);
  });
});
