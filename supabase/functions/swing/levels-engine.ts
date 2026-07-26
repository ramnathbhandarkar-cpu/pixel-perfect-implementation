// MIRROR of src/lib/levels-engine.ts — keep the two in sync (unit tests run against src/lib).
// Phase 3 — nightly level computation.
// Ported from the owner's unit-tested Python system. The constants are
// deliberate; MA_SLOPE_PCT in particular fixes a real misclassification bug
// (see classifyTrend). Do not "simplify" them.

export interface DailyCandle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
}

export interface Pivot {
  index: number;
  price: number;
  kind: "high" | "low";
}

export interface LevelCluster {
  price: number; // running mean of the cluster's pivots
  tests: number; // pivot count — the app's core quality signal
}

export interface TrendResult {
  trendContext: "uptrend" | "DOWNTREND" | "weak / rolling over" | "range / base";
  isDowntrend: boolean;
  slopePct: number | null;
}

export interface ComputedLevels {
  support: number | null;
  supportTests: number;
  resistance: number | null;
  resistanceTests: number;
  trendContext: TrendResult["trendContext"];
  isDowntrend: boolean;
  clusters: LevelCluster[];
}

export const PIVOT_WINDOW = 5; // bars either side
export const CLUSTER_TOLERANCE_PCT = 1.5; // pivots within 1.5% of cluster mean merge
export const MA_SLOPE_PCT = 1.0; // ⚠ bug fix — see classifyTrend
export const MIN_BARS_FOR_LEVELS = 60;

// ─────────────────────────────────────────────────────────────
// Step 1 — swing pivots (window = 5 bars either side)
//   swing_high at i ⟺ high[i] == max(high[i-5 … i+5])
//   swing_low  at i ⟺ low[i]  == min(low[i-5 … i+5])
// ─────────────────────────────────────────────────────────────
export function findSwingPivots(candles: DailyCandle[], window: number = PIVOT_WINDOW): Pivot[] {
  const pivots: Pivot[] = [];
  for (let i = window; i < candles.length - window; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - window; j <= i + window; j++) {
      if (candles[j].high > candles[i].high) isHigh = false;
      if (candles[j].low < candles[i].low) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) pivots.push({ index: i, price: candles[i].high, kind: "high" });
    if (isLow) pivots.push({ index: i, price: candles[i].low, kind: "low" });
  }
  return pivots;
}

// ─────────────────────────────────────────────────────────────
// Step 2 — cluster pivots into levels.
// Pivots within CLUSTER_TOLERANCE_PCT of a running cluster mean belong to the
// same level. tests = pivot count in the cluster. A level touched once is not
// a floor — it is a recent low nothing has argued with yet.
// ─────────────────────────────────────────────────────────────
export function clusterPivots(
  pivots: Pivot[],
  tolerancePct: number = CLUSTER_TOLERANCE_PCT,
): LevelCluster[] {
  if (pivots.length === 0) return [];
  const sorted = pivots.map((p) => p.price).sort((a, b) => a - b);
  const clusters: LevelCluster[] = [];
  let sum = sorted[0];
  let count = 1;
  for (let i = 1; i < sorted.length; i++) {
    const mean = sum / count;
    if (Math.abs(sorted[i] - mean) / mean <= tolerancePct / 100) {
      sum += sorted[i];
      count += 1;
    } else {
      clusters.push({ price: sum / count, tests: count });
      sum = sorted[i];
      count = 1;
    }
  }
  clusters.push({ price: sum / count, tests: count });
  return clusters;
}

// ─────────────────────────────────────────────────────────────
// Step 3 — trend context from SMA50 slope vs 20 bars ago.
//
// ⚠ MA_SLOPE_PCT = 1.0 is a bug fix, not an arbitrary constant. Without the
// threshold, a flat base gets classified as a downtrend, because in a
// sideways range price spends half its time below a flat MA50. A flat base is
// the setup the owner has profitably traded three times; a genuine downtrend
// is the one that cost him ₹11,200.
// ─────────────────────────────────────────────────────────────
export function classifyTrend(closes: number[]): TrendResult {
  const n = closes.length;
  // Need SMA50 now and 20 bars ago → at least 70 bars.
  if (n < 70) {
    return { trendContext: "range / base", isDowntrend: false, slopePct: null };
  }
  const smaAt = (endExclusive: number, period: number): number | null => {
    if (endExclusive < period) return null;
    let s = 0;
    for (let i = endExclusive - period; i < endExclusive; i++) s += closes[i];
    return s / period;
  };
  const price = closes[n - 1];
  const ma50 = smaAt(n, 50)!;
  const ma50Prev = smaAt(n - 20, 50)!;
  const ma200 = smaAt(n, 200); // null when < 200 bars of history
  const slopePct = ((ma50 - ma50Prev) / ma50Prev) * 100;
  const rising = slopePct > MA_SLOPE_PCT;
  const falling = slopePct < -MA_SLOPE_PCT;

  if (ma200 != null && price > ma50 && ma50 > ma200 && rising) {
    return { trendContext: "uptrend", isDowntrend: false, slopePct };
  }
  if (ma200 != null && price < ma50 && ma50 < ma200 && falling) {
    return { trendContext: "DOWNTREND", isDowntrend: true, slopePct };
  }
  if (price < ma50 && falling) {
    return { trendContext: "weak / rolling over", isDowntrend: true, slopePct };
  }
  return { trendContext: "range / base", isDowntrend: false, slopePct };
}

// ─────────────────────────────────────────────────────────────
// Full computation for one symbol over ~1 year of daily candles.
// support    = nearest cluster BELOW the latest close (with its test count)
// resistance = nearest cluster ABOVE the latest close (with its test count)
// ─────────────────────────────────────────────────────────────
export function computeLevels(candles: DailyCandle[]): ComputedLevels | null {
  if (candles.length < MIN_BARS_FOR_LEVELS) return null;
  const price = candles[candles.length - 1].close;
  const clusters = clusterPivots(findSwingPivots(candles));
  let support: LevelCluster | null = null;
  let resistance: LevelCluster | null = null;
  for (const c of clusters) {
    if (c.price < price && (support == null || c.price > support.price)) support = c;
    if (c.price > price && (resistance == null || c.price < resistance.price)) resistance = c;
  }
  const trend = classifyTrend(candles.map((c) => c.close));
  return {
    support: support?.price ?? null,
    supportTests: support?.tests ?? 0,
    resistance: resistance?.price ?? null,
    resistanceTests: resistance?.tests ?? 0,
    trendContext: trend.trendContext,
    isDowntrend: trend.isDowntrend,
    clusters,
  };
}
