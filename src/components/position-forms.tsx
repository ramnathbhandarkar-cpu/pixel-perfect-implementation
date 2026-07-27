import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { writeOrQueue } from "@/lib/offline";
import { delayCost, delayHours, exitHonored, realisedPnl, type Side } from "@/lib/discipline";

// Shared position entry/close forms, used by the merged Trades screen.

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

export interface LineEvent {
  id: string;
  position_id: string;
  detected_at: string;
  price_at_detection: number | null;
}

export interface ActivePlan {
  id: string;
  symbol: string;
  invalidation_line: number;
  target_zone_low: number | null;
  target_zone_high: number | null;
  plan_type: string;
  created_at: string;
}

const inr = (v: number | null | undefined, digits = 2) =>
  v == null ? "\u2014" : `\u20b9${Number(v).toFixed(digits)}`;

export function EntryForm({
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
    try {
      await writeOrQueue("insert", "positions", {
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
      onDone();
    } catch (e2) {
      setBusy(false);
      setErr(e2 instanceof Error ? e2.message : String(e2));
    }
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
          You have no plan waiting, so there is nothing to log an entry against. Write the plan
          first — the level you'd buy at, the price that proves you wrong, and how many shares. This
          is deliberate, not a missing feature: a plan exists before a position does.
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

export function CloseForm({
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
    try {
      await writeOrQueue(
        "update",
        "positions",
        {
          status: "closed",
          exit_price: Number(exitPrice),
          exit_at: exitAtIso,
          exit_reason: reason.trim(),
          charges: Number(charges) || 0,
          realised_pnl: pnl,
        },
        { id: p.id },
      );

      // Delay accounting: the breach event carries the cost of hesitating.
      if (lineEvent) {
        const hours = delayHours(lineEvent.detected_at, exitAtIso);
        const cost =
          lineEvent.price_at_detection != null
            ? delayCost(Number(lineEvent.price_at_detection), Number(exitPrice), p.qty, p.side)
            : null;
        const honored = exitHonored(lineEvent.detected_at, exitAtIso);
        await writeOrQueue(
          "update",
          "discipline_events",
          {
            acted_at: exitAtIso,
            price_at_action: Number(exitPrice),
            delay_hours: Math.round(hours * 100) / 100,
            delay_cost: cost == null ? null : Math.round(cost * 100) / 100,
          },
          { id: lineEvent.id },
        );
        await writeOrQueue("insert", "discipline_events", {
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
    } catch (e2) {
      setBusy(false);
      setErr(e2 instanceof Error ? e2.message : String(e2));
    }
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
