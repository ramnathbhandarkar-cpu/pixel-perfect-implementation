// Phase 4 — discipline maths. Pure functions, unit-tested (see
// discipline.test.ts). These numbers are the product: they measure the two
// failure modes the app exists to prevent — entering without a plan, and
// hesitating after the invalidation line breaks.

export type Side = "long" | "short";

// Distance from current price to the invalidation line, as a % of price.
// Positive = the safe side of the line (above it for longs), negative =
// beyond the line.
export function distanceToLinePct(price: number, line: number, side: Side = "long"): number {
  const raw = ((price - line) / price) * 100;
  return side === "short" ? -raw : raw;
}

export function unrealisedPnl(
  entryPrice: number,
  qty: number,
  lastPrice: number,
  side: Side = "long",
): number {
  const per = side === "short" ? entryPrice - lastPrice : lastPrice - entryPrice;
  return per * qty;
}

export function realisedPnl(
  entryPrice: number,
  exitPrice: number,
  qty: number,
  side: Side = "long",
  charges = 0,
): number {
  const per = side === "short" ? entryPrice - exitPrice : exitPrice - entryPrice;
  return per * qty - charges;
}

// The cost of hesitating: what was lost between the moment the breach was
// detected and the actual exit. Positive = money lost to delay.
export function delayCost(
  priceAtDetection: number,
  exitPrice: number,
  qty: number,
  side: Side = "long",
): number {
  const per = side === "short" ? exitPrice - priceAtDetection : priceAtDetection - exitPrice;
  return per * qty;
}

export function delayHours(detectedAt: string | Date, exitAt: string | Date): number {
  const ms = new Date(exitAt).getTime() - new Date(detectedAt).getTime();
  return Math.max(0, ms / 3_600_000);
}

const istDate = (d: string | Date): string =>
  new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

// Number of NSE trading days (Mon–Fri, IST) that elapse from detection to
// exit: 0 = same session, 1 = next trading day, …
export function tradingSessionsBetween(detectedAt: string | Date, exitAt: string | Date): number {
  const start = istDate(detectedAt);
  const end = istDate(exitAt);
  if (end <= start) return 0;
  let count = 0;
  const cursor = new Date(`${start}T12:00:00Z`);
  const endDate = new Date(`${end}T12:00:00Z`);
  while (cursor < endDate) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const wd = cursor.getUTCDay();
    if (wd !== 0 && wd !== 6) count += 1;
  }
  return count;
}

// A breach honoured = exited within one trading session of detection
// (same day or the next trading day).
export function exitHonored(detectedAt: string | Date, exitAt: string | Date): boolean {
  return tradingSessionsBetween(detectedAt, exitAt) <= 1;
}

// ── scorecard aggregates ─────────────────────────────────────

export interface ClosedTrade {
  realisedPnl: number;
}

export interface TradeStats {
  n: number;
  winRate: number | null; // 0..1
  avgWin: number | null;
  avgLoss: number | null; // negative
  expectancy: number | null; // per-trade expected ₹
}

export function tradeStats(trades: ClosedTrade[]): TradeStats {
  const n = trades.length;
  if (n === 0) return { n: 0, winRate: null, avgWin: null, avgLoss: null, expectancy: null };
  const wins = trades.filter((t) => t.realisedPnl > 0);
  const losses = trades.filter((t) => t.realisedPnl <= 0);
  const winRate = wins.length / n;
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.realisedPnl, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, t) => s + t.realisedPnl, 0) / losses.length : 0;
  const expectancy = winRate * avgWin + (1 - winRate) * avgLoss;
  return { n, winRate, avgWin, avgLoss, expectancy };
}

// Trades per week measured over the span from the first entry to now
// (minimum one week so a single recent trade doesn't read as "7/week").
export function tradesPerWeek(
  entryDates: (string | Date)[],
  now: Date = new Date(),
): number | null {
  if (entryDates.length === 0) return null;
  const first = Math.min(...entryDates.map((d) => new Date(d).getTime()));
  const weeks = Math.max(1, (now.getTime() - first) / (7 * 86400 * 1000));
  return entryDates.length / weeks;
}
