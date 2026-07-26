// Lightweight technical indicators for chart overlays.
// All operate on close-price arrays and return arrays of same length with
// `null` for warm-up bars, ready for lightweight-charts line series.

export interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
}

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  const k = 2 / (period + 1);
  let prev: number | null = null;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      sum += values[i];
      out.push(null);
      continue;
    }
    if (prev == null) {
      sum += values[i];
      prev = sum / period;
      out.push(prev);
      continue;
    }
    prev = values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

// RSI with Wilder's smoothing — single pass.
export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let avgG = 0;
  let avgL = 0;
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    if (i < period) {
      // Seed period: accumulate raw gains/losses.
      avgG += g;
      avgL += l;
      continue;
    }
    if (i === period) {
      avgG = (avgG + g) / period;
      avgL = (avgL + l) / period;
    } else {
      avgG = (avgG * (period - 1) + g) / period;
      avgL = (avgL * (period - 1) + l) / period;
    }
    // Degenerate cases are exact, not approximated: an unbroken run of gains
    // is 100, an unbroken run of losses is 0.
    if (avgL === 0) out[i] = avgG === 0 ? 50 : 100;
    else if (avgG === 0) out[i] = 0;
    else out[i] = 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}

export function bollinger(
  values: number[],
  period = 20,
  mult = 2,
): { mid: (number | null)[]; upper: (number | null)[]; lower: (number | null)[] } {
  const mid = sma(values, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      upper.push(null);
      lower.push(null);
      continue;
    }
    let sumSq = 0;
    const m = mid[i]!;
    for (let j = i - period + 1; j <= i; j++) {
      sumSq += (values[j] - m) ** 2;
    }
    const sd = Math.sqrt(sumSq / period);
    upper.push(m + mult * sd);
    lower.push(m - mult * sd);
  }
  return { mid, upper, lower };
}

export function macd(
  values: number[],
  fast = 12,
  slow = 26,
  signal = 9,
): {
  macd: (number | null)[];
  signal: (number | null)[];
  hist: (number | null)[];
} {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine: (number | null)[] = values.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? emaFast[i]! - emaSlow[i]! : null,
  );
  // Signal = EMA of macd line (ignoring nulls)
  const filtered: number[] = macdLine.map((v) => v ?? 0);
  const sig = ema(filtered, signal);
  // Null out signal where macd is null
  const signalLine = sig.map((v, i) => (macdLine[i] == null ? null : v));
  const hist = macdLine.map((v, i) =>
    v != null && signalLine[i] != null ? v - signalLine[i]! : null,
  );
  return { macd: macdLine, signal: signalLine, hist };
}

export function vwap(candles: Candle[]): (number | null)[] {
  // Session VWAP resets by trading day.
  const out: (number | null)[] = [];
  let day = "";
  let cumPV = 0;
  let cumV = 0;
  for (const c of candles) {
    const d = new Date(c.time * 1000).toISOString().slice(0, 10);
    if (d !== day) {
      day = d;
      cumPV = 0;
      cumV = 0;
    }
    const typical = (c.high + c.low + c.close) / 3;
    const v = c.volume ?? 0;
    cumPV += typical * v;
    cumV += v;
    out.push(cumV > 0 ? cumPV / cumV : null);
  }
  return out;
}
