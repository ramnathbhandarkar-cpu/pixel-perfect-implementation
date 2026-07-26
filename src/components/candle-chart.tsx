import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  sma,
  ema,
  rsi as rsiFn,
  bollinger,
  vwap as vwapFn,
export type { Candle } from "@/lib/indicators";
import type { Candle } from "@/lib/indicators";

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
  height?: number;
}

const BG = "#0f0f11";
const GRID = "rgba(255,255,255,0.05)";
const TEXT = "#9898a6";
const UP = "#1baf7a";
const DOWN = "#e34948";
const AXIS = "rgba(255,255,255,0.14)";

export function CandleChart({
  candles,
  overlays = [],
  showMA = { ma20: true, ma50: true, ma200: true, ema9: false },
  showBB = false,
  showVWAP = false,
  showRSI = true,
  height = 520,
}: CandleChartProps) {
  const priceContainer = useRef<HTMLDivElement>(null);
  const rsiContainer = useRef<HTMLDivElement>(null);
  const priceChartRef = useRef<IChartApi | null>(null);
  const rsiChartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!priceContainer.current) return;

    const priceChart = createChart(priceContainer.current, {
      layout: {
        background: { color: BG },
        textColor: TEXT,
        fontFamily: "JetBrains Mono, ui-monospace, monospace",
      },
      grid: {
        vertLines: { color: GRID },
        horzLines: { color: GRID },
      },
      rightPriceScale: { borderColor: AXIS },
      timeScale: {
        borderColor: AXIS,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: { mode: CrosshairMode.Normal },
      autoSize: true,
    });
    priceChartRef.current = priceChart;

    const candleSeries: ISeriesApi<"Candlestick"> = priceChart.addSeries(
      CandlestickSeries,
      {
        upColor: UP,
        downColor: DOWN,
        wickUpColor: UP,
        wickDownColor: DOWN,
        borderVisible: false,
      },
    );
    const volSeries = priceChart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      color: "rgba(152,152,166,0.35)",
    });
    priceChart.priceScale("vol").applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    const cData = candles.map((c) => ({
      time: c.time as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    candleSeries.setData(cData);
    volSeries.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        value: c.volume ?? 0,
        color: c.close >= c.open ? "rgba(27,175,122,0.35)" : "rgba(227,73,72,0.35)",
      })),
    );

    const closes = candles.map((c) => c.close);

    function addLine(
      values: (number | null)[],
      color: string,
      width: 1 | 2 | 3 | 4 = 1,
    ) {
      const s = priceChart.addSeries(LineSeries, {
        color,
        lineWidth: width,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      s.setData(
        candles
          .map((c, i) =>
            values[i] == null
              ? null
              : { time: c.time as UTCTimestamp, value: values[i] as number },
          )
          .filter((p): p is { time: Time; value: number } => p !== null),
      );
      return s;
    }

    if (showMA.ma20) addLine(sma(closes, 20), "#eda100");
    if (showMA.ma50) addLine(sma(closes, 50), "#2a78d6");
    if (showMA.ma200) addLine(sma(closes, 200), "#8b5cf6");
    if (showMA.ema9) addLine(ema(closes, 9), "#e8e8ec");
    if (showBB) {
      const bb = bollinger(closes, 20, 2);
      addLine(bb.upper, "rgba(152,152,166,0.55)");
      addLine(bb.lower, "rgba(152,152,166,0.55)");
      addLine(bb.mid, "rgba(152,152,166,0.85)");
    }
    if (showVWAP) addLine(vwapFn(candles), "#e34948");

    // Overlays: horizontal price lines
    for (const ov of overlays) {
      candleSeries.createPriceLine({
        price: ov.price,
        color: ov.color,
        lineWidth: 1,
        lineStyle: ov.style === "dashed" ? 2 : ov.style === "dotted" ? 3 : 0,
        axisLabelVisible: true,
        title: ov.label,
      });
    }

    priceChart.timeScale().fitContent();

    // RSI pane
    if (showRSI && rsiContainer.current) {
      const rsiChart = createChart(rsiContainer.current, {
        layout: { background: { color: BG }, textColor: TEXT, fontFamily: "JetBrains Mono, monospace" },
        grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
        rightPriceScale: { borderColor: AXIS },
        timeScale: { borderColor: AXIS, timeVisible: true, secondsVisible: false },
        crosshair: { mode: CrosshairMode.Normal },
        autoSize: true,
      });
      rsiChartRef.current = rsiChart;
      const rsiSeries = rsiChart.addSeries(LineSeries, {
        color: "#8b5cf6",
        lineWidth: 1,
      });
      const rsiVals = rsiFn(closes, 14);
      rsiSeries.setData(
        candles
          .map((c, i) =>
            rsiVals[i] == null
              ? null
              : { time: c.time as UTCTimestamp, value: rsiVals[i] as number },
          )
          .filter((p): p is { time: Time; value: number } => p !== null),
      );
      rsiSeries.createPriceLine({
        price: 70,
        color: "rgba(227,73,72,0.5)",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "70",
      });
      rsiSeries.createPriceLine({
        price: 30,
        color: "rgba(27,175,122,0.5)",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "30",
      });
      rsiChart.timeScale().fitContent();

      // Sync time scale (best-effort)
      const sync = (source: IChartApi, target: IChartApi) => {
        return source.timeScale().subscribeVisibleLogicalRangeChange((r) => {
          if (r) target.timeScale().setVisibleLogicalRange(r);
        });
      };
      sync(priceChart, rsiChart);
      sync(rsiChart, priceChart);
    }

    return () => {
      priceChart.remove();
      rsiChartRef.current?.remove();
      priceChartRef.current = null;
      rsiChartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    candles,
    JSON.stringify(overlays),
    JSON.stringify(showMA),
    showBB,
    showVWAP,
    showRSI,
  ]);

  return (
    <div className="w-full">
      <div
        ref={priceContainer}
        style={{ height: showRSI ? height * 0.72 : height }}
        className="w-full"
      />
      {showRSI && (
        <div
          ref={rsiContainer}
          style={{ height: height * 0.28 }}
          className="w-full border-t border-border"
        />
      )}
    </div>
  );
}
