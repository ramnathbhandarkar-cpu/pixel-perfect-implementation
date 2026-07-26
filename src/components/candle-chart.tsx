import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  CrosshairMode,
  LineStyle,
  PriceScaleMode,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type SeriesType,
  type UTCTimestamp,
} from "lightweight-charts";
import { Camera, Crosshair, Maximize2, Minimize2, Move, Scaling } from "lucide-react";
import {
  sma,
  ema,
  rsi as rsiFn,
  bollinger,
  macd as macdFn,
  vwap as vwapFn,
  type Candle,
} from "@/lib/indicators";
export type { Candle };

export interface Overlay {
  price: number;
  label: string;
  color: string;
  style?: "solid" | "dashed" | "dotted";
}

export interface CandleChartProps {
  candles: Candle[];
  overlays?: Overlay[];
  showMA?: { ma20: boolean; ma50: boolean; ma200: boolean; ema9: boolean };
  showBB?: boolean;
  showVWAP?: boolean;
  showRSI?: boolean;
  showMACD?: boolean;
  height?: number;
  symbol?: string;
  timeframe?: string;
  /** Bumping this refits the visible range (e.g. on symbol/timeframe change). */
  fitKey?: string;
}

// Design tokens — never hardcode a colour that isn't in the app's scale.
const BG = "#0f0f11";
const GRID = "rgba(255,255,255,0.045)";
const TEXT = "#9898a6";
const FAINT = "#5a5a6e";
const UP = "#1baf7a";
const DOWN = "#e34948";
const AXIS = "rgba(255,255,255,0.14)";
const C_MA20 = "#eda100";
const C_MA50 = "#2a78d6";
const C_MA200 = "#8b5cf6";
const C_EMA9 = "#e8e8ec";
const C_BB = "rgba(152,152,166,0.5)";
const C_VWAP = "#e34948";
const C_RSI = "#8b5cf6";

const SUB_PANE_PX = 110;

type LineKey = "ma20" | "ma50" | "ma200" | "ema9" | "bbU" | "bbM" | "bbL" | "vwap";

interface LegendRow {
  label: string;
  value: string;
  color: string;
}

const fmt = (v: number | null | undefined, digits = 2) =>
  v == null || !Number.isFinite(v) ? "—" : v.toFixed(digits);

const fmtVol = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v) || v === 0) return "—";
  if (v >= 1e7) return `${(v / 1e7).toFixed(2)}Cr`;
  if (v >= 1e5) return `${(v / 1e5).toFixed(2)}L`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
};

export function CandleChart({
  candles,
  overlays = [],
  showMA = { ma20: true, ma50: true, ma200: true, ema9: false },
  showBB = false,
  showVWAP = false,
  showRSI = true,
  showMACD = false,
  height = 560,
  symbol,
  timeframe,
  fitKey,
}: CandleChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const chartDivRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const lineRefs = useRef<Partial<Record<LineKey, ISeriesApi<"Line">>>>({});
  const rsiRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdRefs = useRef<{
    line?: ISeriesApi<"Line">;
    signal?: ISeriesApi<"Line">;
    hist?: ISeriesApi<"Histogram">;
  }>({});
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const rafRef = useRef<number | null>(null);

  const [hover, setHover] = useState<number | null>(null); // hovered bar index
  const [logScale, setLogScale] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const subCount = (showRSI ? 1 : 0) + (showMACD ? 1 : 0);

  // ── indicators: computed once per candle set ────────────────
  const ind = useMemo(() => {
    const closes = candles.map((c) => c.close);
    return {
      closes,
      ma20: sma(closes, 20),
      ma50: sma(closes, 50),
      ma200: sma(closes, 200),
      ema9: ema(closes, 9),
      bb: bollinger(closes, 20, 2),
      vwap: vwapFn(candles),
      rsi: rsiFn(closes, 14),
      macd: macdFn(closes, 12, 26, 9),
    };
  }, [candles]);

  const toPoints = useCallback(
    (values: (number | null)[]) =>
      candles
        .map((c, i) =>
          values[i] == null ? null : { time: c.time as UTCTimestamp, value: values[i] as number },
        )
        .filter((p): p is { time: UTCTimestamp; value: number } => p !== null),
    [candles],
  );

  // ── create the chart exactly once ───────────────────────────
  useEffect(() => {
    if (!chartDivRef.current) return;
    const chart = createChart(chartDivRef.current, {
      layout: {
        background: { color: BG },
        textColor: TEXT,
        fontFamily: "JetBrains Mono, ui-monospace, monospace",
        fontSize: 11,
        panes: { separatorColor: AXIS, separatorHoverColor: "rgba(42,120,214,0.4)" },
        attributionLogo: false,
      },
      grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
      rightPriceScale: { borderColor: AXIS, entireTextOnly: true },
      timeScale: {
        borderColor: AXIS,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
      },
      crosshair: {
        // Magnet snaps the readout to the candle's close — the number you
        // actually care about when reading a level.
        mode: CrosshairMode.Magnet,
        vertLine: {
          color: FAINT,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#1e1e24",
        },
        horzLine: {
          color: FAINT,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#1e1e24",
        },
      },
      localization: {
        priceFormatter: (p: number) => p.toFixed(2),
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
      kineticScroll: { touch: true, mouse: false },
      autoSize: true,
    });
    chartRef.current = chart;

    candleRef.current = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      borderVisible: false,
      priceLineColor: FAINT,
      priceLineStyle: LineStyle.Dotted,
    });

    volRef.current = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });

    // Crosshair readout, rAF-throttled so a fast mouse can't thrash React.
    chart.subscribeCrosshairMove((param) => {
      const logical = param.logical;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        setHover(logical == null || param.point == null ? null : Math.round(logical as number));
      });
    });

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volRef.current = null;
      lineRefs.current = {};
      rsiRef.current = null;
      macdRefs.current = {};
      priceLinesRef.current = [];
    };
  }, []);

  // ── price + volume data ─────────────────────────────────────
  useEffect(() => {
    if (!candleRef.current || !volRef.current) return;
    candleRef.current.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
    volRef.current.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        value: c.volume ?? 0,
        color: c.close >= c.open ? "rgba(27,175,122,0.32)" : "rgba(227,73,72,0.32)",
      })),
    );
  }, [candles]);

  // Refit only when the instrument/timeframe changes — never on a toggle, so
  // the zoom you set stays exactly where you put it.
  useEffect(() => {
    if (!chartRef.current || candles.length === 0) return;
    chartRef.current.timeScale().fitContent();
  }, [fitKey, candles.length === 0]);

  // ── overlay price lines (support / resistance / entry) ──────
  useEffect(() => {
    const series = candleRef.current;
    if (!series) return;
    for (const line of priceLinesRef.current) series.removePriceLine(line);
    priceLinesRef.current = overlays.map((ov) =>
      series.createPriceLine({
        price: ov.price,
        color: ov.color,
        lineWidth: 1,
        lineStyle:
          ov.style === "dashed"
            ? LineStyle.Dashed
            : ov.style === "dotted"
              ? LineStyle.Dotted
              : LineStyle.Solid,
        axisLabelVisible: true,
        title: ov.label,
      }),
    );
  }, [overlays]);

  // ── price-pane indicator lines: add/remove without redraw ───
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const want: {
      key: LineKey;
      on: boolean;
      color: string;
      values: (number | null)[];
      width?: 1 | 2;
    }[] = [
      { key: "ma20", on: showMA.ma20, color: C_MA20, values: ind.ma20 },
      { key: "ma50", on: showMA.ma50, color: C_MA50, values: ind.ma50 },
      { key: "ma200", on: showMA.ma200, color: C_MA200, values: ind.ma200 },
      { key: "ema9", on: showMA.ema9, color: C_EMA9, values: ind.ema9 },
      { key: "bbU", on: showBB, color: C_BB, values: ind.bb.upper },
      { key: "bbM", on: showBB, color: C_BB, values: ind.bb.mid },
      { key: "bbL", on: showBB, color: C_BB, values: ind.bb.lower },
      { key: "vwap", on: showVWAP, color: C_VWAP, values: ind.vwap },
    ];

    for (const w of want) {
      const existing = lineRefs.current[w.key];
      if (w.on && !existing) {
        const s = chart.addSeries(LineSeries, {
          color: w.color,
          lineWidth: w.width ?? 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        s.setData(toPoints(w.values));
        lineRefs.current[w.key] = s;
      } else if (w.on && existing) {
        existing.setData(toPoints(w.values));
      } else if (!w.on && existing) {
        chart.removeSeries(existing);
        delete lineRefs.current[w.key];
      }
    }
  }, [ind, showMA, showBB, showVWAP, toPoints]);

  // ── sub-panes: RSI and MACD ─────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Rebuild sub-panes when the enabled set changes so pane indices stay
    // correct after a pane is removed.
    if (rsiRef.current) {
      chart.removeSeries(rsiRef.current);
      rsiRef.current = null;
    }
    for (const s of Object.values(macdRefs.current)) {
      if (s) chart.removeSeries(s as ISeriesApi<SeriesType>);
    }
    macdRefs.current = {};

    let pane = 1;
    if (showRSI) {
      const rsiPane = pane++;
      const s = chart.addSeries(
        LineSeries,
        {
          color: C_RSI,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: true,
          // RSI is bounded — pin the axis to 0–100 so the 30/70 bands sit
          // where the eye expects instead of drifting with the data.
          autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
        },
        rsiPane,
      );
      s.setData(toPoints(ind.rsi));
      for (const [p, c] of [
        [70, "rgba(227,73,72,0.45)"],
        [50, "rgba(152,152,166,0.25)"],
        [30, "rgba(27,175,122,0.45)"],
      ] as const) {
        s.createPriceLine({
          price: p,
          color: c,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: String(p),
        });
      }
      rsiRef.current = s;
    }
    if (showMACD) {
      const macdPane = pane++;
      const hist = chart.addSeries(
        HistogramSeries,
        { priceFormat: { type: "price", precision: 2, minMove: 0.01 }, priceLineVisible: false },
        macdPane,
      );
      hist.setData(
        candles
          .map((c, i) =>
            ind.macd.hist[i] == null
              ? null
              : {
                  time: c.time as UTCTimestamp,
                  value: ind.macd.hist[i] as number,
                  color:
                    (ind.macd.hist[i] as number) >= 0
                      ? "rgba(27,175,122,0.5)"
                      : "rgba(227,73,72,0.5)",
                },
          )
          .filter((p): p is { time: UTCTimestamp; value: number; color: string } => p !== null),
      );
      const line = chart.addSeries(
        LineSeries,
        { color: C_MA50, lineWidth: 1, priceLineVisible: false, lastValueVisible: false },
        macdPane,
      );
      line.setData(toPoints(ind.macd.macd));
      const signal = chart.addSeries(
        LineSeries,
        { color: C_MA20, lineWidth: 1, priceLineVisible: false, lastValueVisible: false },
        macdPane,
      );
      signal.setData(toPoints(ind.macd.signal));
      macdRefs.current = { hist, line, signal };
    }

    // Sizing each sub-pane directly makes them fight: every setHeight bleeds
    // its delta out of the panes set before it. Instead size only the price
    // pane; the sub-panes split the remainder evenly, and they all want the
    // same height anyway.
    if (subCount > 0) {
      const applySizing = () => {
        const panes = chart.panes();
        if (panes.length < 2) return;
        const total = panes.reduce((sum, p) => sum + p.getHeight(), 0);
        const target = Math.max(160, total - subCount * SUB_PANE_PX);
        panes[0].setHeight(target);
      };
      applySizing();
      const raf = requestAnimationFrame(applySizing);
      return () => cancelAnimationFrame(raf);
    }
  }, [showRSI, showMACD, subCount, ind, candles, toPoints]);

  // ── log / linear price scale ────────────────────────────────
  useEffect(() => {
    chartRef.current
      ?.priceScale("right")
      .applyOptions({ mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal });
  }, [logScale]);

  // ── keyboard navigation ─────────────────────────────────────
  const fit = useCallback(() => chartRef.current?.timeScale().fitContent(), []);
  const scrollToLast = useCallback(() => chartRef.current?.timeScale().scrollToRealTime(), []);
  const pan = useCallback((bars: number) => {
    const ts = chartRef.current?.timeScale();
    const r = ts?.getVisibleLogicalRange();
    if (!ts || !r) return;
    ts.setVisibleLogicalRange({ from: r.from + bars, to: r.to + bars });
  }, []);
  const zoom = useCallback((factor: number) => {
    const ts = chartRef.current?.timeScale();
    const r = ts?.getVisibleLogicalRange();
    if (!ts || !r) return;
    const mid = (r.from + r.to) / 2;
    const half = ((r.to - r.from) / 2) * factor;
    ts.setVisibleLogicalRange({ from: mid - half, to: mid + half });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      const step = e.shiftKey ? 20 : 5;
      switch (e.key) {
        case "ArrowLeft":
          pan(-step);
          e.preventDefault();
          break;
        case "ArrowRight":
          pan(step);
          e.preventDefault();
          break;
        case "+":
        case "=":
          zoom(0.8);
          break;
        case "-":
        case "_":
          zoom(1.25);
          break;
        case "f":
        case "F":
          fit();
          break;
        case "l":
        case "L":
          setLogScale((v) => !v);
          break;
        case "e":
        case "E":
          scrollToLast();
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pan, zoom, fit, scrollToLast]);

  // ── fullscreen ──────────────────────────────────────────────
  const toggleFullscreen = useCallback(async () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await el.requestFullscreen().catch(() => {});
  }, []);

  useEffect(() => {
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const snapshot = useCallback(() => {
    const canvas = chartRef.current?.takeScreenshot();
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `${symbol ?? "chart"}-${timeframe ?? ""}-${new Date()
      .toISOString()
      .slice(0, 10)}.png`;
    a.click();
  }, [symbol, timeframe]);

  // ── legend values at the hovered (or last) bar ──────────────
  const legend = useMemo(() => {
    if (candles.length === 0) return null;
    const i = hover != null && hover >= 0 && hover < candles.length ? hover : candles.length - 1;
    const c = candles[i];
    const prev = i > 0 ? candles[i - 1] : null;
    const change = prev ? c.close - prev.close : 0;
    const changePct = prev && prev.close ? (change / prev.close) * 100 : 0;
    const rows: LegendRow[] = [];
    if (showMA.ma20) rows.push({ label: "MA20", value: fmt(ind.ma20[i]), color: C_MA20 });
    if (showMA.ma50) rows.push({ label: "MA50", value: fmt(ind.ma50[i]), color: C_MA50 });
    if (showMA.ma200) rows.push({ label: "MA200", value: fmt(ind.ma200[i]), color: C_MA200 });
    if (showMA.ema9) rows.push({ label: "EMA9", value: fmt(ind.ema9[i]), color: C_EMA9 });
    if (showBB)
      rows.push({
        label: "BB",
        value: `${fmt(ind.bb.lower[i])} · ${fmt(ind.bb.upper[i])}`,
        color: C_BB,
      });
    if (showVWAP) rows.push({ label: "VWAP", value: fmt(ind.vwap[i]), color: C_VWAP });
    if (showRSI) rows.push({ label: "RSI", value: fmt(ind.rsi[i], 1), color: C_RSI });
    if (showMACD)
      rows.push({
        label: "MACD",
        value: `${fmt(ind.macd.macd[i])} / ${fmt(ind.macd.signal[i])}`,
        color: C_MA50,
      });
    return {
      isLive: hover == null,
      time: new Date(c.time * 1000).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "2-digit",
        hour: timeframe === "1d" || timeframe === "1wk" ? undefined : "2-digit",
        minute: timeframe === "1d" || timeframe === "1wk" ? undefined : "2-digit",
      }),
      o: c.open,
      h: c.high,
      l: c.low,
      c: c.close,
      volume: c.volume,
      change,
      changePct,
      rows,
    };
  }, [candles, hover, ind, showMA, showBB, showVWAP, showRSI, showMACD, timeframe]);

  const subPanes = subCount * SUB_PANE_PX;

  return (
    <div ref={wrapRef} className="relative w-full bg-background">
      {/* Legend + controls. pointer-events-none so it never eats a drag. */}
      <div className="absolute top-2 left-3 z-10 pointer-events-none select-none">
        {legend && (
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 font-mono text-xs">
              {symbol && <span className="text-foreground font-semibold">{symbol}</span>}
              {timeframe && <span className="text-faint">{timeframe}</span>}
              <span className="text-faint">{legend.time}</span>
              {!legend.isLive && (
                <span className="text-[10px] text-accent-info uppercase tracking-wider">
                  cursor
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 font-mono text-[11px]">
              <span className="text-faint">
                O <span className="text-muted-fg">{fmt(legend.o)}</span>
              </span>
              <span className="text-faint">
                H <span className="text-muted-fg">{fmt(legend.h)}</span>
              </span>
              <span className="text-faint">
                L <span className="text-muted-fg">{fmt(legend.l)}</span>
              </span>
              <span className="text-faint">
                C <span className="text-foreground font-semibold">{fmt(legend.c)}</span>
              </span>
              <span className={legend.change >= 0 ? "text-bullish" : "text-bearish"}>
                {legend.change >= 0 ? "+" : ""}
                {fmt(legend.change)} ({legend.changePct >= 0 ? "+" : ""}
                {legend.changePct.toFixed(2)}%)
              </span>
              <span className="text-faint">
                Vol <span className="text-muted-fg">{fmtVol(legend.volume)}</span>
              </span>
            </div>
            {legend.rows.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px]">
                {legend.rows.map((r) => (
                  <span key={r.label} className="flex items-center gap-1">
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full"
                      style={{ background: r.color }}
                    />
                    <span className="text-faint">{r.label}</span>
                    <span className="text-muted-fg">{r.value}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Chart-native controls */}
      <div className="absolute top-2 right-3 z-10 flex items-center gap-1">
        <ChartBtn onClick={fit} title="Fit all data (F)">
          <Scaling size={13} />
        </ChartBtn>
        <ChartBtn onClick={scrollToLast} title="Jump to latest (E)">
          <Move size={13} />
        </ChartBtn>
        <ChartBtn
          onClick={() => setLogScale((v) => !v)}
          title="Toggle log scale (L)"
          active={logScale}
        >
          <span className="text-[10px] font-mono px-0.5">log</span>
        </ChartBtn>
        <ChartBtn onClick={snapshot} title="Download PNG">
          <Camera size={13} />
        </ChartBtn>
        <ChartBtn onClick={toggleFullscreen} title="Fullscreen">
          {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </ChartBtn>
      </div>

      <div
        ref={chartDivRef}
        style={{ height: fullscreen ? "100vh" : height + subPanes }}
        className="w-full"
      />

      {/* Keyboard hints — desktop only, quiet by design */}
      <div className="hidden md:flex items-center gap-3 px-3 py-1.5 border-t border-border text-[10px] text-faint font-mono">
        <span className="flex items-center gap-1">
          <Crosshair size={10} /> hover for values
        </span>
        <span>← → pan</span>
        <span>shift+← → fast</span>
        <span>+ − zoom</span>
        <span>F fit</span>
        <span>E latest</span>
        <span>L log</span>
      </div>
    </div>
  );
}

function ChartBtn({
  onClick,
  title,
  active,
  children,
}: {
  onClick: () => void;
  title: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={
        "h-6 min-w-6 px-1 flex items-center justify-center rounded border transition-colors " +
        (active
          ? "border-accent-info bg-accent-info/15 text-foreground"
          : "border-border bg-surface/80 text-muted-fg hover:text-foreground hover:border-border-strong")
      }
    >
      {children}
    </button>
  );
}
