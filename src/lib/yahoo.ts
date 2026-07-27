// Yahoo Finance chart API — the fallback price source, and now the default.
//
// The point of this file is that the app should be useful at 9am without
// anyone having logged into anything. Kite gives better data but its token
// dies every day; Yahoo needs no auth at all. Everything here is pure so the
// parsing rules can be tested without a network.

export type Timeframe = "15m" | "1h" | "1d" | "1wk";

export interface Candle {
  symbol: string;
  timeframe: Timeframe;
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

// Yahoo's own interval names. "1h" is accepted but "60m" is what their
// charts actually request, so use that.
const YAHOO_INTERVAL: Record<Timeframe, string> = {
  "15m": "15m",
  "1h": "60m",
  "1d": "1d",
  "1wk": "1wk",
};

// Yahoo caps how far back intraday history goes and answers a too-large
// range with an error rather than a clamp, so clamp it here.
const MAX_DAYS: Record<Timeframe, number> = {
  "15m": 55,
  "1h": 700,
  "1d": 3650,
  "1wk": 3650,
};

/** NSE tickers are `RELIANCE.NS` on Yahoo. */
export function yahooTicker(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  return s.endsWith(".NS") ? s : `${s}.NS`;
}

export function yahooChartUrl(symbol: string, timeframe: Timeframe, days: number): string {
  const span = Math.min(Math.max(1, Math.floor(days)), MAX_DAYS[timeframe]);
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - span * 86400;
  const q = new URLSearchParams({
    interval: YAHOO_INTERVAL[timeframe],
    period1: String(period1),
    period2: String(period2),
    events: "div,split",
    includePrePost: "false",
  });
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    yahooTicker(symbol),
  )}?${q.toString()}`;
}

// A daily candle has to land on the same instant whichever provider it came
// from, or the same session gets stored twice under two timestamps and every
// level computed from it is wrong. Kite's convention is IST midnight, so
// daily and weekly bars are snapped to that. Intraday bars are already
// candle-open instants and agree between providers.
export function normaliseTs(epochSeconds: number, timeframe: Timeframe): string {
  const d = new Date(epochSeconds * 1000);
  if (timeframe !== "1d" && timeframe !== "1wk") return d.toISOString();
  // en-CA renders as YYYY-MM-DD, which is the only reason to use that locale.
  const istDate = d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return new Date(`${istDate}T00:00:00+05:30`).toISOString();
}

interface YahooQuote {
  open?: (number | null)[];
  high?: (number | null)[];
  low?: (number | null)[];
  close?: (number | null)[];
  volume?: (number | null)[];
}

export interface YahooChartResponse {
  chart?: {
    result?: {
      meta?: { symbol?: string };
      timestamp?: number[];
      indicators?: { quote?: YahooQuote[] };
    }[];
    error?: { code?: string; description?: string } | null;
  };
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Turn a Yahoo chart payload into candles.
 *
 * Yahoo pads its arrays with nulls for halts, holidays and the not-yet-open
 * part of the current session. Those are gaps, not zero-priced bars — a
 * single one of them silently poisons every level and indicator downstream,
 * so any row missing an OHLC value is dropped rather than coerced.
 */
export function parseYahooChart(
  body: YahooChartResponse,
  symbol: string,
  timeframe: Timeframe,
): Candle[] {
  const err = body?.chart?.error;
  if (err) throw new Error(`Yahoo: ${err.description ?? err.code ?? "unknown error"}`);

  const result = body?.chart?.result?.[0];
  const stamps = result?.timestamp;
  const quote = result?.indicators?.quote?.[0];
  // No result at all is a genuine "nothing here" — an unlisted ticker, or a
  // range with no sessions in it. Callers treat an empty array as no-data and
  // leave whatever is already stored alone.
  if (!result || !stamps || !quote) return [];

  const out: Candle[] = [];
  for (let i = 0; i < stamps.length; i++) {
    const o = quote.open?.[i];
    const h = quote.high?.[i];
    const l = quote.low?.[i];
    const c = quote.close?.[i];
    if (!finite(o) || !finite(h) || !finite(l) || !finite(c)) continue;
    if (!finite(stamps[i])) continue;
    // A zero or negative price is never real for a listed equity.
    if (o <= 0 || h <= 0 || l <= 0 || c <= 0) continue;
    const v = quote.volume?.[i];
    out.push({
      symbol: symbol.trim().toUpperCase().replace(/\.NS$/, ""),
      timeframe,
      ts: normaliseTs(stamps[i], timeframe),
      open: o,
      high: h,
      low: l,
      close: c,
      volume: finite(v) ? v : null,
    });
  }

  // Yahoo occasionally repeats the final stamp when a session is in progress;
  // last write wins so the freshest version of a bar survives.
  const byTs = new Map<string, Candle>();
  for (const row of out) byTs.set(row.ts, row);
  return [...byTs.values()].sort((a, b) => a.ts.localeCompare(b.ts));
}
