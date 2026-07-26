import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { PageHeader, PageBody, DisclaimerFooter } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { delayHours } from "@/lib/discipline";

export const Route = createFileRoute("/_authenticated/today")({
  head: () => ({
    meta: [
      { title: "Today · Swing Trade" },
      {
        name: "description",
        content: "Open positions, breached invalidation lines, today's screener result.",
      },
    ],
  }),
  component: TodayScreen,
});

interface OpenPosition {
  id: string;
  symbol: string;
  qty: number;
  entry_price: number;
  invalidation_at_entry: number;
}

interface Breach {
  position: OpenPosition;
  detected_at: string;
  price_at_detection: number | null;
  current: { close: number; ts: string } | null;
}

const inr = (v: number | null | undefined) => (v == null ? "—" : `₹${Number(v).toFixed(2)}`);

const istTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

function TodayScreen() {
  const now = new Date();
  const ist = now.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
  });

  const [openPositions, setOpenPositions] = useState<OpenPosition[]>([]);
  const [breaches, setBreaches] = useState<Breach[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: pos } = await supabase
        .from("positions")
        .select("id, symbol, qty, entry_price, invalidation_at_entry")
        .eq("status", "open");
      const open = (pos ?? []) as OpenPosition[];
      setOpenPositions(open);
      if (open.length) {
        const [{ data: events }, { data: candleRows }] = await Promise.all([
          supabase
            .from("discipline_events")
            .select("position_id, detected_at, price_at_detection")
            .eq("event_type", "line_crossed")
            .in(
              "position_id",
              open.map((p) => p.id),
            ),
          supabase
            .from("candles")
            .select("symbol, ts, close")
            .in("timeframe", ["15m", "1d"])
            .in("symbol", [...new Set(open.map((p) => p.symbol))])
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
        const list: Breach[] = [];
        for (const e of events ?? []) {
          const position = open.find((p) => p.id === e.position_id);
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
      setLoaded(true);
    })();
  }, []);

  return (
    <>
      <PageHeader title="Today" subtitle={`IST ${ist} · NSE 09:15–15:30`} />
      <PageBody>
        <div className="space-y-4">
          {/* Non-dismissible: stays while any breached position remains open. */}
          {breaches.map((b) => (
            <div
              key={b.position.id}
              className="bg-bearish/15 border border-bearish/50 rounded-lg px-4 py-3"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className="text-bearish mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="text-foreground font-medium">
                    <span className="font-mono">{b.position.symbol}</span> — invalidation line
                    crossed at {inr(b.price_at_detection)} on {istTime(b.detected_at)}. Your plan
                    says exit.
                  </p>
                  <p className="text-muted-fg text-xs mt-0.5 font-mono">
                    Currently {b.current ? inr(b.current.close) : "—"} (
                    {delayHours(b.detected_at, new Date()).toFixed(1)} hours since the breach)
                    {" · "}
                    <Link to="/positions" className="text-accent-info hover:underline">
                      go to position
                    </Link>
                  </p>
                </div>
              </div>
            </div>
          ))}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="surface p-4">
              <div className="text-[11px] text-faint uppercase tracking-widest">
                Breached invalidation lines
              </div>
              <p className="text-sm text-muted-fg mt-2 leading-relaxed">
                {!loaded
                  ? "Loading…"
                  : breaches.length === 0
                    ? "No open positions have closed beyond their invalidation line."
                    : `${breaches.length} open position${breaches.length === 1 ? " has" : "s have"} closed beyond the line — details above.`}
              </p>
            </div>

            <div className="surface p-4">
              <div className="text-[11px] text-faint uppercase tracking-widest">Open positions</div>
              <p className="text-sm text-muted-fg mt-2 leading-relaxed">
                {!loaded ? (
                  "Loading…"
                ) : openPositions.length === 0 ? (
                  <>
                    You have no open positions. Log one from the{" "}
                    <Link to="/positions" className="text-accent-info hover:underline">
                      Positions screen
                    </Link>{" "}
                    — a Watch Plan is required first.
                  </>
                ) : (
                  <>
                    <span className="text-foreground">{openPositions.length}</span> open:{" "}
                    <span className="font-mono">
                      {openPositions.map((p) => p.symbol).join(", ")}
                    </span>
                    {" · "}
                    <Link to="/positions" className="text-accent-info hover:underline">
                      view
                    </Link>
                  </>
                )}
              </p>
            </div>

            <ScreenerCard />
            <AlertsCard />
          </div>
        </div>
      </PageBody>
      <DisclaimerFooter />
    </>
  );
}

function ScreenerCard() {
  const [run, setRun] = useState<{
    run_date: string;
    qualifying: unknown[];
    scanned: number | null;
  } | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("screener_runs")
        .select("run_date, qualifying, scanned")
        .order("run_date", { ascending: false })
        .limit(1);
      setRun((data?.[0] as typeof run) ?? null);
      setLoaded(true);
    })();
  }, []);

  const count = run && Array.isArray(run.qualifying) ? run.qualifying.length : 0;

  return (
    <div className="surface p-4">
      <div className="text-[11px] text-faint uppercase tracking-widest">Today's screener</div>
      {!loaded ? (
        <p className="text-sm text-muted-fg mt-2">Loading…</p>
      ) : run == null ? (
        <p className="text-sm text-muted-fg mt-2 leading-relaxed">
          No screener run saved yet. Open the{" "}
          <Link to="/screener" className="text-accent-info hover:underline">
            Screener
          </Link>{" "}
          to compute levels and run it.
        </p>
      ) : (
        <p className="text-sm text-muted-fg mt-2 leading-relaxed">
          {count === 0 ? (
            <>Last run {run.run_date}: no qualifying setups — a normal result, not a failure. </>
          ) : (
            <>
              Last run {run.run_date}: <span className="text-foreground">{count} qualifying</span>{" "}
              of {run.scanned ?? "—"} scanned.{" "}
            </>
          )}
          <Link to="/screener" className="text-accent-info hover:underline">
            View
          </Link>
        </p>
      )}
    </div>
  );
}

function AlertsCard() {
  const [unread, setUnread] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const { count } = await supabase
        .from("alerts")
        .select("id", { count: "exact", head: true })
        .is("read_at", null);
      setUnread(count ?? 0);
    })();
  }, []);

  return (
    <div className="surface p-4">
      <div className="text-[11px] text-faint uppercase tracking-widest">Unread alerts</div>
      <p className="text-sm text-muted-fg mt-2 leading-relaxed">
        {unread == null ? (
          "Loading…"
        ) : unread === 0 ? (
          "No unread alerts."
        ) : (
          <>
            <span className="text-foreground">{unread}</span> unread ·{" "}
            <Link to="/alerts" className="text-accent-info hover:underline">
              open inbox
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
