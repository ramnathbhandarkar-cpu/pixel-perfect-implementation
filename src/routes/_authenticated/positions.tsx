import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, PageBody, DisclaimerFooter } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import {
  delayCost,
  delayHours,
  distanceToLinePct,
  exitHonored,
  realisedPnl,
  unrealisedPnl,
  type Side,
} from "@/lib/discipline";
import { AlertTriangle, Plus, X } from "lucide-react";

export const Route = createFileRoute("/_authenticated/positions")({
  head: () => ({
    meta: [
      { title: "Positions · Swing Trade" },
      { name: "description", content: "Open and closed positions, each linked to a plan." },
    ],
  }),
  component: PositionsScreen,
});

export interface Position {
  id: string;
  symbol: string;
  plan_id: string;
  side: Side;
  qty: number;
  entry_price: number;
  entry_at: string;
  exit_price: number | null;
  exit_at: string | null;
  status: "open" | "closed";
  invalidation_at_entry: number;
  target_at_entry: number | null;
  realised_pnl: number | null;
  charges: number;
  entry_reason: string | null;
  exit_reason: string | null;
}

interface LineEvent {
  id: string;
  position_id: string;
  detected_at: string;
  price_at_detection: number | null;
}

interface ActivePlan {
  id: string;
  symbol: string;
  invalidation_line: number;
  target_zone_low: number | null;
  target_zone_high: number | null;
  plan_type: string;
  created_at: string;
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

function PositionsScreen() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [lineEvents, setLineEvents] = useState<Map<string, LineEvent>>(new Map());
  const [closes, setCloses] = useState<Map<string, { close: number; ts: string }>>(new Map());
  const [plans, setPlans] = useState<ActivePlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showEntry, setShowEntry] = useState(false);
  const [closing, setClosing] = useState<Position | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const [posRes, planRes] = await Promise.all([
      supabase.from("positions").select("*").order("entry_at", { ascending: false }),
      supabase
        .from("watch_plans")
        .select(
          "id, symbol, invalidation_line, target_zone_low, target_zone_high, plan_type, created_at",
        )
        .eq("status", "active")
        .order("symbol"),
    ]);
    if (posRes.error) {
      setErr(posRes.error.message);
      setLoading(false);
      return;
    }
    const rows = (posRes.data ?? []) as Position[];
    setPositions(rows);
    setPlans((planRes.data ?? []) as ActivePlan[]);

    const ids = rows.map((p) => p.id);
    if (ids.length) {
      const { data: events } = await supabase
        .from("discipline_events")
        .select("id, position_id, detected_at, price_at_detection")
        .eq("event_type", "line_crossed")
        .in("position_id", ids);
      const map = new Map<string, LineEvent>();
      for (const e of (events ?? []) as LineEvent[]) map.set(e.position_id, e);
      setLineEvents(map);
    } else {
      setLineEvents(new Map());
    }

    const symbols = [...new Set(rows.map((p) => p.symbol))];
    if (symbols.length) {
      const cutoff = new Date(Date.now() - 21 * 86400 * 1000).toISOString();
      const { data: candleRows } = await supabase
        .from("candles")
        .select("symbol, ts, close")
        .in("timeframe", ["15m", "1d"])
        .in("symbol", symbols)
        .gte("ts", cutoff)
        .order("ts", { ascending: false })
        .limit(3000);
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
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const open = useMemo(() => positions.filter((p) => p.status === "open"), [positions]);
  const closed = useMemo(() => positions.filter((p) => p.status === "closed"), [positions]);

  return (
    <>
      <PageHeader
        title="Positions"
        subtitle="Every entry requires a linked plan"
        actions={
          <button
            onClick={() => setShowEntry(true)}
            className="btn-primary hover:btn-primary-hover text-xs"
          >
            <Plus size={13} className="inline -mt-0.5 mr-1" />
            Log entry
          </button>
        }
      />
      <PageBody>
        <div className="space-y-4">
          {err && <div className="text-xs text-bearish">{err}</div>}

          {showEntry && (
            <EntryForm
              plans={plans}
              onDone={() => {
                setShowEntry(false);
                void load();
              }}
              onCancel={() => setShowEntry(false)}
            />
          )}

          {closing && (
            <CloseForm
              position={closing}
              lineEvent={lineEvents.get(closing.id) ?? null}
              onDone={() => {
                setClosing(null);
                void load();
              }}
              onCancel={() => setClosing(null)}
            />
          )}

          {loading ? (
            <div className="text-sm text-muted-fg">Loading…</div>
          ) : open.length === 0 && !showEntry ? (
            <div className="surface p-10 text-center space-y-2">
              <p className="text-base text-foreground">No open positions.</p>
              <p className="text-sm text-muted-fg">
                Log an entry when a written plan exists — the form requires one.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {open.map((p) => (
                <OpenPositionCard
                  key={p.id}
                  position={p}
                  lineEvent={lineEvents.get(p.id) ?? null}
                  close={closes.get(p.symbol) ?? null}
                  onClose={() => setClosing(p)}
                />
              ))}
            </div>
          )}

          {closed.length > 0 && (
            <details className="mt-6" open>
              <summary className="text-xs text-faint uppercase tracking-widest cursor-pointer">
                Closed ({closed.length})
              </summary>
              <div className="surface overflow-x-auto mt-3">
                <table className="data w-full text-sm whitespace-nowrap">
                  <thead className="text-[11px] uppercase tracking-widest text-faint">
                    <tr className="border-b border-border">
                      <th className="text-left px-3 py-2 font-medium">Symbol</th>
                      <th className="num px-3 py-2 font-medium">Qty</th>
                      <th className="num px-3 py-2 font-medium">Entry</th>
                      <th className="num px-3 py-2 font-medium">Exit</th>
                      <th className="num px-3 py-2 font-medium">P&L</th>
                      <th className="text-left px-3 py-2 font-medium">Exit reason</th>
                      <th className="text-left px-3 py-2 font-medium">Dates</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closed.map((p) => (
                      <tr key={p.id} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 font-mono font-medium">{p.symbol}</td>
                        <td className="num px-3 py-2">{p.qty}</td>
                        <td className="num px-3 py-2">{inr(p.entry_price)}</td>
                        <td className="num px-3 py-2">{inr(p.exit_price)}</td>
                        <td
                          className={
                            "num px-3 py-2 font-medium " +
                            ((p.realised_pnl ?? 0) >= 0 ? "text-bullish" : "text-bearish")
                          }
                        >
                          {inr(p.realised_pnl, 0)}
                        </td>
                        <td className="px-3 py-2 text-muted-fg text-xs">{p.exit_reason ?? "—"}</td>
                        <td className="px-3 py-2 text-faint text-xs font-mono">
                          {p.entry_at.slice(0, 10)} → {p.exit_at?.slice(0, 10) ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </div>
      </PageBody>
      <DisclaimerFooter />
    </>
  );
}

function OpenPositionCard({
  position: p,
  lineEvent,
  close,
  onClose,
}: {
  position: Position;
  lineEvent: LineEvent | null;
  close: { close: number; ts: string } | null;
  onClose: () => void;
}) {
  // Re-render every minute so the "Z hours ago" count stays live — the
  // delay should be visible, not abstract.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const upnl = close ? unrealisedPnl(Number(p.entry_price), p.qty, close.close, p.side) : null;
  const upnlPct = close
    ? ((close.close - Number(p.entry_price)) / Number(p.entry_price)) *
      100 *
      (p.side === "short" ? -1 : 1)
    : null;
  const dist = close
    ? distanceToLinePct(close.close, Number(p.invalidation_at_entry), p.side)
    : null;
  const hoursSince = lineEvent ? delayHours(lineEvent.detected_at, new Date()) : null;
  const stillBeyond = dist != null && dist <= 0;

  return (
    <div className={"surface overflow-hidden " + (lineEvent ? "border-bearish/60" : "")}>
      {lineEvent && (
        <div className="bg-bearish/15 border-b border-bearish/40 px-4 py-3 text-sm">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="text-bearish mt-0.5 shrink-0" />
            <div>
              <p className="text-foreground font-medium">
                Invalidation line crossed at {inr(lineEvent.price_at_detection)} on{" "}
                {istTime(lineEvent.detected_at)}. Your plan says exit.
              </p>
              <p className="text-muted-fg text-xs mt-0.5 font-mono">
                Currently {close ? inr(close.close) : "—"}
                {hoursSince != null && <> · line crossed {hoursSince.toFixed(1)} hours ago</>}
                {!stillBeyond &&
                  close &&
                  " · price is back inside the line — the breach is still on record"}
              </p>
            </div>
          </div>
        </div>
      )}
      <div className="p-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="font-mono font-semibold text-base">{p.symbol}</span>
          <span className="text-[11px] text-faint uppercase tracking-widest">
            {p.side} · {p.qty} qty
          </span>
          <span className="text-xs text-muted-fg font-mono">
            entry <span className="text-foreground">{inr(p.entry_price)}</span>
            <span className="text-faint"> · {p.entry_at.slice(0, 10)}</span>
          </span>
          {close && (
            <span className="text-xs text-muted-fg font-mono">
              now <span className="text-foreground">{inr(close.close)}</span>
              <span className="text-faint"> · as of {istTime(close.ts)}</span>
            </span>
          )}
          {upnl != null && (
            <span
              className={
                "text-sm font-mono font-semibold " + (upnl >= 0 ? "text-bullish" : "text-bearish")
              }
            >
              {upnl >= 0 ? "+" : ""}
              {inr(upnl, 0)} ({upnlPct != null ? upnlPct.toFixed(1) : "—"}%)
            </span>
          )}
          <button
            onClick={onClose}
            className="ml-auto text-xs px-3 py-1.5 rounded border border-border text-muted-fg hover:text-foreground"
          >
            Close position
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs font-mono text-muted-fg">
          <span>
            line <span className="text-foreground">{inr(p.invalidation_at_entry)}</span>
            <span className="text-faint"> (snapshot at entry)</span>
          </span>
          {dist != null && (
            <span className={stillBeyond ? "text-warning font-semibold" : ""}>
              {Math.abs(dist).toFixed(1)}% {stillBeyond ? "BEYOND line" : "above line"}
            </span>
          )}
          {p.target_at_entry != null && <span>target {inr(p.target_at_entry)}</span>}
          {p.entry_reason && <span className="text-faint">{p.entry_reason}</span>}
        </div>
      </div>
    </div>
  );
}

function EntryForm({
  plans,
  onDone,
  onCancel,
}: {
  plans: ActivePlan[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [planId, setPlanId] = useState("");
  const [side, setSide] = useState<Side>("long");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [entryAt, setEntryAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const plan = plans.find((p) => p.id === planId) ?? null;
  const canSubmit = plan != null && Number(qty) > 0 && Number(price) > 0 && !busy;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!plan || !canSubmit) return;
    setBusy(true);
    setErr(null);
    // Snapshot the plan's lines at entry — the plan may be edited later; the
    // position must remember what was agreed.
    const { error } = await supabase.from("positions").insert({
      symbol: plan.symbol,
      plan_id: plan.id,
      side,
      qty: Number(qty),
      entry_price: Number(price),
      entry_at: new Date(entryAt).toISOString(),
      status: "open",
      invalidation_at_entry: Number(plan.invalidation_line),
      target_at_entry: plan.target_zone_low ?? plan.target_zone_high,
      entry_reason: reason.trim() || null,
    });
    setBusy(false);
    if (error) setErr(error.message);
    else onDone();
  }

  if (plans.length === 0) {
    return (
      <div className="surface p-6 border-warning/40">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-foreground">Log entry</h2>
          <button onClick={onCancel} className="text-muted-fg hover:text-foreground">
            <X size={15} />
          </button>
        </div>
        <p className="text-sm text-muted-fg mt-3">
          No active plans exist, so no position can be logged. Write the plan first —{" "}
          <Link to="/plans" className="text-accent-info hover:underline">
            create one on the Plans screen
          </Link>
          . This is deliberate: a plan must exist before a position exists.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={save} className="surface p-4 space-y-4 border-accent-info/40">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-foreground">Log entry</h2>
        <button type="button" onClick={onCancel} className="text-muted-fg hover:text-foreground">
          <X size={15} />
        </button>
      </div>

      <label className="block">
        <span className="text-xs text-muted-fg">
          Watch plan * — entries without one are not possible
        </span>
        <select
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
          required
          className="mt-1 w-full bg-surface-raised border border-border rounded-md px-2.5 py-2 text-sm font-mono"
        >
          <option value="">Select a plan…</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.symbol} · line ₹{Number(p.invalidation_line).toFixed(2)} · {p.plan_type}
            </option>
          ))}
        </select>
      </label>

      {plan && (
        <p className="text-xs text-muted-fg font-mono">
          Snapshot at entry: invalidation{" "}
          <span className="text-warning">{inr(plan.invalidation_line)}</span>
          {(plan.target_zone_low ?? plan.target_zone_high) ? (
            <> · target {inr(plan.target_zone_low ?? plan.target_zone_high)}</>
          ) : null}
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <label className="block">
          <span className="text-xs text-muted-fg">Side</span>
          <select
            value={side}
            onChange={(e) => setSide(e.target.value as Side)}
            className="mt-1 w-full bg-surface-raised border border-border rounded-md px-2.5 py-2 text-sm"
          >
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-muted-fg">Quantity *</span>
          <input
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            type="number"
            min="1"
            step="1"
            required
            className="mt-1 w-full font-mono bg-surface-raised border border-border rounded-md px-2.5 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted-fg">Entry price (₹) *</span>
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            type="number"
            min="0"
            step="0.05"
            required
            className="mt-1 w-full font-mono bg-surface-raised border border-border rounded-md px-2.5 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted-fg">Entered at</span>
          <input
            value={entryAt}
            onChange={(e) => setEntryAt(e.target.value)}
            type="datetime-local"
            className="mt-1 w-full font-mono bg-surface-raised border border-border rounded-md px-2.5 py-2 text-sm"
          />
        </label>
      </div>

      <label className="block">
        <span className="text-xs text-muted-fg">Entry reason</span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-1 w-full bg-surface-raised border border-border rounded-md px-2.5 py-2 text-sm"
          placeholder="Which plan condition triggered this"
        />
      </label>

      <button
        type="submit"
        disabled={!canSubmit}
        className="btn-primary hover:btn-primary-hover disabled:opacity-60"
      >
        {busy ? "Saving…" : "Log position"}
      </button>
      {err && <span className="text-xs text-bearish ml-3">{err}</span>}
    </form>
  );
}

function CloseForm({
  position: p,
  lineEvent,
  onDone,
  onCancel,
}: {
  position: Position;
  lineEvent: LineEvent | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [exitPrice, setExitPrice] = useState("");
  const [exitAt, setExitAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [reason, setReason] = useState("");
  const [charges, setCharges] = useState("0");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canSubmit = Number(exitPrice) > 0 && reason.trim() !== "" && !busy;

  const preview =
    Number(exitPrice) > 0
      ? realisedPnl(Number(p.entry_price), Number(exitPrice), p.qty, p.side, Number(charges) || 0)
      : null;
  const previewDelay =
    lineEvent?.price_at_detection != null && Number(exitPrice) > 0
      ? delayCost(Number(lineEvent.price_at_detection), Number(exitPrice), p.qty, p.side)
      : null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    const exitAtIso = new Date(exitAt).toISOString();
    const pnl = realisedPnl(
      Number(p.entry_price),
      Number(exitPrice),
      p.qty,
      p.side,
      Number(charges) || 0,
    );
    const { error } = await supabase
      .from("positions")
      .update({
        status: "closed",
        exit_price: Number(exitPrice),
        exit_at: exitAtIso,
        exit_reason: reason.trim(),
        charges: Number(charges) || 0,
        realised_pnl: pnl,
      })
      .eq("id", p.id);
    if (error) {
      setBusy(false);
      setErr(error.message);
      return;
    }

    // Delay accounting: the breach event carries the cost of hesitating.
    if (lineEvent) {
      const hours = delayHours(lineEvent.detected_at, exitAtIso);
      const cost =
        lineEvent.price_at_detection != null
          ? delayCost(Number(lineEvent.price_at_detection), Number(exitPrice), p.qty, p.side)
          : null;
      const honored = exitHonored(lineEvent.detected_at, exitAtIso);
      await supabase
        .from("discipline_events")
        .update({
          acted_at: exitAtIso,
          price_at_action: Number(exitPrice),
          delay_hours: Math.round(hours * 100) / 100,
          delay_cost: cost == null ? null : Math.round(cost * 100) / 100,
        })
        .eq("id", lineEvent.id);
      await supabase.from("discipline_events").insert({
        position_id: p.id,
        event_type: honored ? "exit_honored" : "exit_delayed",
        detected_at: lineEvent.detected_at,
        acted_at: exitAtIso,
        price_at_detection: lineEvent.price_at_detection,
        price_at_action: Number(exitPrice),
        delay_hours: Math.round(hours * 100) / 100,
        delay_cost: cost == null ? null : Math.round(cost * 100) / 100,
        note: honored
          ? "Exited within one trading session of the breach."
          : "Exit came later than one trading session after the breach.",
      });
    }
    setBusy(false);
    onDone();
  }

  return (
    <form onSubmit={save} className="surface p-4 space-y-4 border-warning/40">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          Close position — <span className="font-mono">{p.symbol}</span>
        </h2>
        <button type="button" onClick={onCancel} className="text-muted-fg hover:text-foreground">
          <X size={15} />
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <label className="block">
          <span className="text-xs text-muted-fg">Exit price (₹) *</span>
          <input
            value={exitPrice}
            onChange={(e) => setExitPrice(e.target.value)}
            type="number"
            min="0"
            step="0.05"
            required
            className="mt-1 w-full font-mono bg-surface-raised border border-border rounded-md px-2.5 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted-fg">Exited at *</span>
          <input
            value={exitAt}
            onChange={(e) => setExitAt(e.target.value)}
            type="datetime-local"
            required
            className="mt-1 w-full font-mono bg-surface-raised border border-border rounded-md px-2.5 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted-fg">Charges (₹)</span>
          <input
            value={charges}
            onChange={(e) => setCharges(e.target.value)}
            type="number"
            min="0"
            step="0.01"
            className="mt-1 w-full font-mono bg-surface-raised border border-border rounded-md px-2.5 py-2 text-sm"
          />
        </label>
        <div className="block text-xs font-mono pt-5">
          {preview != null && (
            <span className={preview >= 0 ? "text-bullish" : "text-bearish"}>
              P&L {preview >= 0 ? "+" : ""}
              {inr(preview, 0)}
            </span>
          )}
          {previewDelay != null && previewDelay > 0 && (
            <span className="block text-warning mt-1">
              of which {inr(previewDelay, 0)} lost after the line broke
            </span>
          )}
        </div>
      </div>

      <label className="block">
        <span className="text-xs text-muted-fg">Exit reason *</span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          className="mt-1 w-full bg-surface-raised border border-border rounded-md px-2.5 py-2 text-sm"
          placeholder="Line hit / target reached / plan faded / other — say which"
        />
      </label>

      <button
        type="submit"
        disabled={!canSubmit}
        className="btn-primary hover:btn-primary-hover disabled:opacity-60"
      >
        {busy ? "Closing…" : "Close position"}
      </button>
      {err && <span className="text-xs text-bearish ml-3">{err}</span>}
    </form>
  );
}
