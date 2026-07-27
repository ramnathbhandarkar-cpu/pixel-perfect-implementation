import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { PageHeader, PageBody, DisclaimerFooter } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { delayHours, unrealisedPnl, type Side } from "@/lib/discipline";
import { marketStatus } from "@/lib/market";

// The only screen he should need most days.
export const Route = createFileRoute("/_authenticated/home")({
  head: () => ({
    meta: [
      { title: "Swing Trade" },
      { name: "description", content: "What needs your attention today." },
    ],
  }),
  component: HomeScreen,
});

interface OpenPosition {
  id: string;
  symbol: string;
  qty: number;
  side: Side;
  entry_price: number;
  invalidation_at_entry: number;
}

interface Breach {
  position: OpenPosition;
  detected_at: string;
  price_at_detection: number | null;
  current: { close: number; ts: string } | null;
}

interface ScreenerRun {
  run_date: string;
  qualifying: { symbol: string; ratio: number | null }[];
  scanned: number | null;
}

const inr = (v: number | null | undefined, digits = 2) =>
  v == null ? "—" : `₹${Number(v).toFixed(digits)}`;

const istTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

function HomeScreen() {
  const [open, setOpen] = useState<OpenPosition[]>([]);
  const [breaches, setBreaches] = useState<Breach[]>([]);
  const [closes, setCloses] = useState<Map<string, { close: number; ts: string }>>(new Map());
  const [run, setRun] = useState<ScreenerRun | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [offline, setOffline] = useState(false);

  const market = marketStatus();

  const load = useCallback(async () => {
    try {
      const [posRes, runRes] = await Promise.all([
        supabase
          .from("positions")
          .select("id, symbol, qty, side, entry_price, invalidation_at_entry")
          .eq("status", "open"),
        supabase
          .from("screener_runs")
          .select("run_date, qualifying, scanned")
          .order("run_date", { ascending: false })
          .limit(1),
      ]);
      if (posRes.error) throw new Error(posRes.error.message);
      const positions = (posRes.data ?? []) as OpenPosition[];
      setOpen(positions);
      setRun((runRes.data?.[0] as ScreenerRun) ?? null);

      if (positions.length) {
        const [{ data: events }, { data: candleRows }] = await Promise.all([
          supabase
            .from("discipline_events")
            .select("position_id, detected_at, price_at_detection")
            .eq("event_type", "line_crossed")
            .in(
              "position_id",
              positions.map((p) => p.id),
            ),
          supabase
            .from("candles")
            .select("symbol, ts, close")
            .in("timeframe", ["15m", "1d"])
            .in("symbol", [...new Set(positions.map((p) => p.symbol))])
            .gte("ts", new Date(Date.now() - 21 * 86400 * 1000).toISOString())
            .order("ts", { ascending: false })
            .limit(3000),
        ]);
        const latest = new Map<string, { close: number; ts: string }>();
        for (const row of candleRows ?? []) {
          if (!latest.has(row.symbol as string)) {
            latest.set(row.symbol as string, {
              close: Number(row.close),
              ts: row.ts as string,
            });
          }
        }
        setCloses(latest);
        const list: Breach[] = [];
        for (const e of events ?? []) {
          const position = positions.find((p) => p.id === e.position_id);
          if (!position) continue;
          list.push({
            position,
            detected_at: e.detected_at as string,
            price_at_detection: e.price_at_detection == null ? null : Number(e.price_at_detection),
            current: latest.get(position.symbol) ?? null,
          });
        }
        setBreaches(list);
      }
      setOffline(false);
    } catch {
      setOffline(true);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const qualifying = run?.qualifying?.length ?? 0;

  return (
    <>
      <PageHeader title="Today" subtitle={`${market.label} · ${market.istTime} IST`} />
      <PageBody>
        <div className="space-y-4">
          {offline && (
            <p className="text-xs px-3 py-2 rounded border bg-warning/10 text-warning border-warning/40">
              Couldn't reach market data — anything shown may be out of date.
            </p>
          )}

          {/* Breaches first, loudest, undismissible */}
          {breaches.map((b) => (
            <div
              key={b.position.id}
              className="bg-bearish/15 border border-bearish/50 rounded-lg px-4 py-3.5"
            >
              <div className="flex items-start gap-2.5">
                <AlertTriangle size={18} className="text-bearish mt-0.5 shrink-0" />
                <div className="text-sm min-w-0">
                  <p className="text-foreground font-medium">
                    <span className="font-mono">{b.position.symbol}</span> is past the price you
                    said you'd sell at.
                  </p>
                  <p className="text-muted-fg text-xs mt-1 font-mono">
                    You said {inr(b.position.invalidation_at_entry)} · it was{" "}
                    {inr(b.price_at_detection)} on {istTime(b.detected_at)}
                    {b.current && ` · now ${inr(b.current.close)}`} ·{" "}
                    {delayHours(b.detected_at, new Date()).toFixed(1)} hours ago
                  </p>
                  <Link
                    to="/trades"
                    className="inline-block mt-2 text-xs px-3 py-1.5 rounded border border-bearish/50 text-foreground hover:bg-bearish/10"
                  >
                    Go to this trade
                  </Link>
                </div>
              </div>
            </div>
          ))}

          {/* Open positions */}
          <section className="surface p-4">
            <div className="text-[11px] text-faint uppercase tracking-widest">
              What you're holding
            </div>
            {!loaded ? (
              <p className="text-sm text-muted-fg mt-2">Loading…</p>
            ) : open.length === 0 ? (
              <p className="text-sm text-muted-fg mt-2 leading-relaxed">
                Nothing open right now.{" "}
                <Link to="/trades" className="text-accent-info hover:underline">
                  Write a plan
                </Link>{" "}
                before you buy anything — that is the habit this app exists to keep.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {open.map((p) => {
                  const c = closes.get(p.symbol);
                  const pnl = c
                    ? unrealisedPnl(Number(p.entry_price), p.qty, c.close, p.side)
                    : null;
                  return (
                    <li key={p.id} className="flex flex-wrap items-baseline gap-x-3 text-sm">
                      <Link to="/trades" className="font-mono font-medium hover:underline">
                        {p.symbol}
                      </Link>
                      <span className="text-xs text-muted-fg font-mono">
                        {p.qty} @ {inr(p.entry_price)}
                      </span>
                      {c && (
                        <span className="text-xs text-muted-fg font-mono">now {inr(c.close)}</span>
                      )}
                      {pnl != null && (
                        <span
                          className={
                            "font-mono font-semibold " +
                            (pnl >= 0 ? "text-bullish" : "text-bearish")
                          }
                        >
                          {pnl >= 0 ? "+" : ""}
                          {inr(pnl, 0)}
                        </span>
                      )}
                      <span className="ml-auto text-[11px] text-faint font-mono">
                        exit at {inr(p.invalidation_at_entry)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Today's screener */}
          <section className="surface p-4">
            <div className="text-[11px] text-faint uppercase tracking-widest">
              Setups worth a look
            </div>
            {!loaded ? (
              <p className="text-sm text-muted-fg mt-2">Loading…</p>
            ) : run == null ? (
              <p className="text-sm text-muted-fg mt-2 leading-relaxed">
                Nothing measured yet. The list is worked out overnight from the stocks you're
                following.
              </p>
            ) : qualifying === 0 ? (
              <div className="mt-2">
                <p className="text-sm text-foreground">Nothing qualifies today.</p>
                <p className="text-sm text-muted-fg mt-1 leading-relaxed">
                  That is a normal result, not a failure. Good setups are not a daily occurrence —{" "}
                  {run.scanned ?? 0} stocks were measured on {run.run_date}.
                </p>
              </div>
            ) : (
              <div className="mt-2">
                <p className="text-sm text-foreground">
                  {qualifying} of {run.scanned ?? 0} look worth measuring further.
                </p>
                <p className="text-sm font-mono text-muted-fg mt-1">
                  {run.qualifying
                    .slice(0, 6)
                    .map((q) => q.symbol)
                    .join(" · ")}
                </p>
                <Link
                  to="/screener"
                  className="inline-block mt-2 text-xs text-accent-info hover:underline"
                >
                  See the numbers
                </Link>
              </div>
            )}
          </section>
        </div>
      </PageBody>
      <DisclaimerFooter />
    </>
  );
}
