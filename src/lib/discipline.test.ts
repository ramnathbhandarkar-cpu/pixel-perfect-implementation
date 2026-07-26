import { describe, expect, it } from "bun:test";
import {
  delayCost,
  delayHours,
  distanceToLinePct,
  exitHonored,
  realisedPnl,
  tradeStats,
  tradesPerWeek,
  tradingSessionsBetween,
  unrealisedPnl,
} from "./discipline";

describe("delay cost — the price of hesitating", () => {
  it("reproduces the ITC case: ₹4,000 at the line, ₹7,200 lost to delay", () => {
    // Line breached with price at detection ₹X; exit later, lower. The
    // extra loss beyond the line is purely the cost of hesitating.
    // 400 qty, detected at ₹230, exited at ₹212 → 18 × 400 = ₹7,200.
    expect(delayCost(230, 212, 400)).toBe(7200);
  });

  it("is zero when the exit happens at the detection price", () => {
    expect(delayCost(230, 230, 400)).toBe(0);
  });

  it("is negative when the price recovered before exit (delay paid off — still recorded)", () => {
    expect(delayCost(230, 235, 400)).toBe(-2000);
  });

  it("inverts for short positions", () => {
    expect(delayCost(100, 110, 50, "short")).toBe(500);
  });
});

describe("trading sessions / honoured exits (IST)", () => {
  // 2026-07-22 is a Wednesday, 2026-07-24 a Friday, 2026-07-27 a Monday.
  it("same-day exit is within one session", () => {
    expect(tradingSessionsBetween("2026-07-22T05:00:00Z", "2026-07-22T09:00:00Z")).toBe(0);
    expect(exitHonored("2026-07-22T05:00:00Z", "2026-07-22T09:00:00Z")).toBe(true);
  });

  it("next-trading-day exit is honoured", () => {
    expect(tradingSessionsBetween("2026-07-22T05:00:00Z", "2026-07-23T05:00:00Z")).toBe(1);
    expect(exitHonored("2026-07-22T05:00:00Z", "2026-07-23T05:00:00Z")).toBe(true);
  });

  it("two trading days later is delayed", () => {
    expect(tradingSessionsBetween("2026-07-22T05:00:00Z", "2026-07-24T05:00:00Z")).toBe(2);
    expect(exitHonored("2026-07-22T05:00:00Z", "2026-07-24T05:00:00Z")).toBe(false);
  });

  it("skips the weekend: Friday breach exited Monday is honoured", () => {
    expect(tradingSessionsBetween("2026-07-24T05:00:00Z", "2026-07-27T05:00:00Z")).toBe(1);
    expect(exitHonored("2026-07-24T05:00:00Z", "2026-07-27T05:00:00Z")).toBe(true);
  });

  it("measures delay in hours", () => {
    expect(delayHours("2026-07-22T05:00:00Z", "2026-07-22T09:30:00Z")).toBeCloseTo(4.5, 6);
  });
});

describe("P&L", () => {
  it("computes unrealised P&L for longs and shorts", () => {
    expect(unrealisedPnl(100, 10, 105)).toBe(50);
    expect(unrealisedPnl(100, 10, 95, "short")).toBe(50);
  });

  it("computes realised P&L net of charges", () => {
    expect(realisedPnl(100, 110, 10, "long", 40)).toBe(60);
    expect(realisedPnl(100, 90, 10, "short", 40)).toBe(60);
  });
});

describe("distance to the invalidation line", () => {
  it("positive when price sits the safe side of the line", () => {
    // price 102, line 100 → 1.96% above for a long
    expect(distanceToLinePct(102, 100)).toBeCloseTo(1.9608, 3);
  });

  it("negative once the line is breached", () => {
    expect(distanceToLinePct(98, 100)).toBeLessThan(0);
  });

  it("inverts for shorts (below the line is safe)", () => {
    expect(distanceToLinePct(98, 100, "short")).toBeGreaterThan(0);
  });
});

describe("trade stats / expectancy", () => {
  it("computes win rate, averages, and expectancy", () => {
    const s = tradeStats([
      { realisedPnl: 1000 },
      { realisedPnl: 500 },
      { realisedPnl: -600 },
      { realisedPnl: -400 },
    ]);
    expect(s.n).toBe(4);
    expect(s.winRate).toBeCloseTo(0.5, 6);
    expect(s.avgWin).toBeCloseTo(750, 6);
    expect(s.avgLoss).toBeCloseTo(-500, 6);
    // 0.5×750 + 0.5×(−500) = 125
    expect(s.expectancy).toBeCloseTo(125, 6);
  });

  it("returns nulls with no closed trades — an empty record is not a zero record", () => {
    const s = tradeStats([]);
    expect(s.n).toBe(0);
    expect(s.winRate).toBeNull();
    expect(s.expectancy).toBeNull();
  });

  it("computes trades per week over the active span", () => {
    const now = new Date("2026-07-26T00:00:00Z");
    const rate = tradesPerWeek(
      [
        "2026-06-28T00:00:00Z",
        "2026-07-05T00:00:00Z",
        "2026-07-12T00:00:00Z",
        "2026-07-19T00:00:00Z",
      ],
      now,
    );
    expect(rate).toBeCloseTo(1, 6);
    expect(tradesPerWeek([], now)).toBeNull();
  });
});
