import { describe, expect, it } from "bun:test";
import {
  normaliseTs,
  parseYahooChart,
  yahooChartUrl,
  yahooTicker,
  type YahooChartResponse,
} from "./yahoo";

const chart = (
  timestamp: number[],
  quote: Record<string, (number | null)[]>,
): YahooChartResponse => ({
  chart: { result: [{ timestamp, indicators: { quote: [quote] } }], error: null },
});

describe("yahooTicker", () => {
  it("appends .NS for NSE", () => {
    expect(yahooTicker("reliance")).toBe("RELIANCE.NS");
  });

  it("does not double up an existing suffix", () => {
    expect(yahooTicker("INFY.NS")).toBe("INFY.NS");
  });
});

describe("yahooChartUrl", () => {
  it("maps timeframes to Yahoo's interval names", () => {
    expect(yahooChartUrl("ITC", "1h", 30)).toContain("interval=60m");
    expect(yahooChartUrl("ITC", "15m", 30)).toContain("interval=15m");
    expect(yahooChartUrl("ITC", "1d", 30)).toContain("interval=1d");
    expect(yahooChartUrl("ITC", "1wk", 30)).toContain("interval=1wk");
  });

  it("clamps intraday history to what Yahoo will actually serve", () => {
    const url = new URL(yahooChartUrl("ITC", "15m", 400));
    const span = Number(url.searchParams.get("period2")) - Number(url.searchParams.get("period1"));
    expect(span).toBe(55 * 86400);
  });

  it("encodes the ticker with its suffix", () => {
    expect(yahooChartUrl("MAZDOCK", "1d", 10)).toContain("/chart/MAZDOCK.NS?");
  });
});

describe("normaliseTs", () => {
  it("snaps daily bars to IST midnight so Kite and Yahoo agree", () => {
    // Yahoo stamps a daily NSE bar at the 09:15 IST open: 03:45Z.
    expect(normaliseTs(Date.parse("2026-07-27T03:45:00Z") / 1000, "1d")).toBe(
      "2026-07-26T18:30:00.000Z", // = 2026-07-27 00:00 IST
    );
  });

  it("snaps weekly bars the same way", () => {
    expect(normaliseTs(Date.parse("2026-07-27T03:45:00Z") / 1000, "1wk")).toBe(
      "2026-07-26T18:30:00.000Z",
    );
  });

  it("leaves intraday bars at their exact candle-open instant", () => {
    const t = Date.parse("2026-07-27T04:00:00Z") / 1000;
    expect(normaliseTs(t, "15m")).toBe("2026-07-27T04:00:00.000Z");
  });
});

describe("parseYahooChart", () => {
  const t0 = Date.parse("2026-07-27T03:45:00Z") / 1000;
  const day = 86400;

  it("reads a clean payload", () => {
    const rows = parseYahooChart(
      chart([t0, t0 + day], {
        open: [100, 102],
        high: [105, 106],
        low: [99, 101],
        close: [104, 103],
        volume: [1000, 2000],
      }),
      "reliance",
      "1d",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].symbol).toBe("RELIANCE");
    expect({ ...rows[0], symbol: undefined, timeframe: undefined, ts: undefined }).toEqual({
      symbol: undefined,
      timeframe: undefined,
      ts: undefined,
      open: 100,
      high: 105,
      low: 99,
      close: 104,
      volume: 1000,
    });
  });

  it("drops null gaps instead of turning them into zero-priced bars", () => {
    const rows = parseYahooChart(
      chart([t0, t0 + day, t0 + 2 * day], {
        open: [100, null, 102],
        high: [105, null, 106],
        low: [99, null, 101],
        close: [104, null, 103],
        volume: [1000, null, 2000],
      }),
      "ITC",
      "1d",
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.close > 0)).toBe(true);
  });

  it("drops a bar whose close is missing even when the rest is present", () => {
    const rows = parseYahooChart(
      chart([t0], { open: [100], high: [105], low: [99], close: [null], volume: [10] }),
      "ITC",
      "1d",
    );
    expect(rows).toHaveLength(0);
  });

  it("rejects non-positive prices", () => {
    const rows = parseYahooChart(
      chart([t0, t0 + day], {
        open: [0, 102],
        high: [0, 106],
        low: [0, 101],
        close: [0, 103],
        volume: [0, 2000],
      }),
      "ITC",
      "1d",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].close).toBe(103);
  });

  it("keeps a bar with a missing volume but sound prices", () => {
    const rows = parseYahooChart(
      chart([t0], { open: [100], high: [105], low: [99], close: [104], volume: [null] }),
      "ITC",
      "1d",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].volume).toBeNull();
  });

  it("returns empty rather than throwing when there is no result", () => {
    expect(parseYahooChart({ chart: { result: [] } }, "ITC", "1d")).toEqual([]);
    expect(parseYahooChart({}, "ITC", "1d")).toEqual([]);
  });

  it("throws on an explicit Yahoo error so the caller can retry", () => {
    expect(() =>
      parseYahooChart(
        {
          chart: {
            error: { code: "Not Found", description: "No data found, symbol may be delisted" },
          },
        },
        "NOPE",
        "1d",
      ),
    ).toThrow(/delisted/);
  });

  it("dedupes a repeated timestamp, keeping the later version", () => {
    const rows = parseYahooChart(
      chart([t0, t0], {
        open: [100, 100],
        high: [105, 107],
        low: [99, 99],
        close: [104, 106],
        volume: [1000, 1500],
      }),
      "ITC",
      "1d",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].close).toBe(106);
  });

  it("returns rows in ascending time order", () => {
    const rows = parseYahooChart(
      chart([t0 + 2 * day, t0, t0 + day], {
        open: [3, 1, 2],
        high: [3, 1, 2],
        low: [3, 1, 2],
        close: [3, 1, 2],
        volume: [3, 1, 2],
      }),
      "ITC",
      "1d",
    );
    expect(rows.map((r) => r.close)).toEqual([1, 2, 3]);
  });

  it("strips a .NS suffix from the stored symbol", () => {
    const rows = parseYahooChart(
      chart([t0], { open: [1], high: [1], low: [1], close: [1], volume: [1] }),
      "INFY.NS",
      "1d",
    );
    expect(rows[0].symbol).toBe("INFY");
  });
});
