import { useEffect, useRef } from "react";

// TradingView's Advanced Real-Time Chart widget. It brings the things our own
// canvas could not: trendlines, Fibonacci, horizontal lines, price-axis
// compression, full history on every timeframe, and symbol search — with no
// API key and no data plumbing on our side.
//
// TradingView's terms require the attribution link to stay visible.

export interface TradingViewChartProps {
  /** Bare NSE symbol, e.g. "RELIANCE". */
  symbol: string;
  /** TradingView interval code: 15, 60, D, W. */
  interval?: string;
  height?: number;
}

const SCRIPT_SRC = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";

export function TradingViewChart({ symbol, interval = "D", height = 560 }: TradingViewChartProps) {
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;

    // The embed script replaces its own container, so rebuild the subtree on
    // every symbol/interval change rather than trying to mutate it.
    el.innerHTML = "";
    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.height = `${height}px`;
    el.appendChild(widget);

    const attribution = document.createElement("div");
    attribution.className = "tradingview-widget-copyright";
    attribution.innerHTML =
      '<a href="https://www.tradingview.com/" rel="noopener nofollow" target="_blank">' +
      '<span style="color:#5a5a6e;font-size:10px">Chart by TradingView</span></a>';
    el.appendChild(attribution);

    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.innerHTML = JSON.stringify({
      symbol: `NSE:${symbol}`,
      interval,
      timezone: "Asia/Kolkata",
      theme: "dark",
      style: "1",
      locale: "in",
      // Match our tokens so it doesn't look bolted on.
      backgroundColor: "#0f0f11",
      gridColor: "rgba(255, 255, 255, 0.05)",
      allow_symbol_change: true,
      hide_side_toolbar: false, // the drawing toolbar
      hide_top_toolbar: false,
      withdateranges: true,
      save_image: false,
      details: false,
      calendar: false,
      support_host: "https://www.tradingview.com",
      autosize: false,
      width: "100%",
      height,
      studies: ["STD;SMA", "STD;RSI"],
    });
    el.appendChild(script);

    return () => {
      el.innerHTML = "";
    };
  }, [symbol, interval, height]);

  return (
    <div
      ref={holder}
      className="tradingview-widget-container w-full"
      style={{ minHeight: height }}
    />
  );
}
