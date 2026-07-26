import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { PageHeader, PageBody, DisclaimerFooter } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/alerts")({
  head: () => ({
    meta: [
      { title: "Alerts · Swing Trade" },
      { name: "description", content: "Alert inbox and rule configuration." },
    ],
  }),
  component: AlertsScreen,
});

interface AlertRow {
  id: string;
  symbol: string | null;
  alert_type: string | null;
  severity: "info" | "warning" | "critical";
  title: string | null;
  body: string | null;
  triggered_at: string;
  read_at: string | null;
  payload: { position_id?: string } | null;
}

interface RuleRow {
  id: string;
  symbol: string;
  rule_type: "volume_hourly" | "level_cross" | "price_target";
  threshold: number | null;
  is_active: boolean;
  last_fired_candle: string | null;
}

const RULE_TYPES: { key: RuleRow["rule_type"]; label: string; needsThreshold: boolean }[] = [
  { key: "volume_hourly", label: "Hourly volume above", needsThreshold: true },
  { key: "level_cross", label: "Level crossed (S/R)", needsThreshold: false },
  { key: "price_target", label: "Price crosses", needsThreshold: true },
];

const istTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

function AlertsScreen() {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [openPositionIds, setOpenPositionIds] = useState<Set<string>>(new Set());
  const [symbols, setSymbols] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // new-rule form
  const [ruleSymbol, setRuleSymbol] = useState("");
  const [ruleType, setRuleType] = useState<RuleRow["rule_type"]>("volume_hourly");
  const [ruleThreshold, setRuleThreshold] = useState("");
  const [savingRule, setSavingRule] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [aRes, rRes, pRes, sRes] = await Promise.all([
      supabase
        .from("alerts")
        .select("*")
        .order("triggered_at", { ascending: false })
        .limit(200),
      supabase.from("alert_rules").select("*").order("symbol"),
      supabase.from("positions").select("id").eq("status", "open"),
      supabase
        .from("stocks")
        .select("symbol, list_type, is_active")
        .neq("list_type", "archived")
        .eq("is_active", true)
        .order("symbol"),
    ]);
    if (aRes.error) setErr(aRes.error.message);
    setAlerts((aRes.data ?? []) as AlertRow[]);
    setRules((rRes.data ?? []) as RuleRow[]);
    setOpenPositionIds(new Set((pRes.data ?? []).map((p) => p.id as string)));
    setSymbols([...new Set((sRes.data ?? []).map((r) => r.symbol as string))]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A critical discipline alert stays pinned and unclearable while the
  // underlying condition holds (the position is still open).
  const isPinned = useCallback(
    (a: AlertRow) =>
      a.severity === "critical" &&
      a.alert_type === "line_crossed" &&
      a.payload?.position_id != null &&
      openPositionIds.has(a.payload.position_id),
    [openPositionIds],
  );

  const sorted = useMemo(() => {
    const pinned = alerts.filter(isPinned);
    const rest = alerts.filter((a) => !isPinned(a));
    return [...pinned, ...rest];
  }, [alerts, isPinned]);

  async function markRead(a: AlertRow) {
    const { error } = await supabase
      .from("alerts")
      .update({ read_at: new Date().toISOString() })
      .eq("id", a.id);
    if (error) setErr(error.message);
    else void load();
  }

  async function markAllRead() {
    const clearable = alerts.filter((a) => !isPinned(a) && a.read_at == null).map((a) => a.id);
    if (!clearable.length) return;
    const { error } = await supabase
      .from("alerts")
      .update({ read_at: new Date().toISOString() })
      .in("id", clearable);
    if (error) setErr(error.message);
    else void load();
  }

  async function addRule(e: React.FormEvent) {
    e.preventDefault();
    const needsThreshold = RULE_TYPES.find((t) => t.key === ruleType)?.needsThreshold;
    if (!ruleSymbol || (needsThreshold && !(Number(ruleThreshold) > 0))) return;
    setSavingRule(true);
    const { error } = await supabase.from("alert_rules").insert({
      symbol: ruleSymbol,
      rule_type: ruleType,
      threshold: needsThreshold ? Number(ruleThreshold) : null,
      is_active: true,
    });
    setSavingRule(false);
    if (error) setErr(error.message);
    else {
      setRuleThreshold("");
      void load();
    }
  }

  async function toggleRule(r: RuleRow) {
    const { error } = await supabase
      .from("alert_rules")
      .update({ is_active: !r.is_active })
      .eq("id", r.id);
    if (error) setErr(error.message);
    else void load();
  }

  async function deleteRule(r: RuleRow) {
    const { error } = await supabase.from("alert_rules").delete().eq("id", r.id);
    if (error) setErr(error.message);
    else void load();
  }

  const unread = alerts.filter((a) => a.read_at == null).length;

  return (
    <>
      <PageHeader
        title="Alerts"
        subtitle="Inbox and rules · one alert per candle, never more"
        actions={
          unread > 0 ? (
            <button
              onClick={markAllRead}
              className="text-xs px-3 py-1.5 rounded border border-border text-muted-fg hover:text-foreground"
            >
              Mark all read
            </button>
          ) : undefined
        }
      />
      <PageBody>
        <div className="space-y-5">
          {err && <div className="text-xs text-bearish">{err}</div>}

          {/* Rules */}
          <section className="surface p-4">
            <h2 className="text-sm font-semibold text-foreground">Rules</h2>
            <form onSubmit={addRule} className="mt-3 flex flex-wrap items-end gap-2">
              <label className="block">
                <span className="text-xs text-muted-fg">Symbol</span>
                <select
                  value={ruleSymbol}
                  onChange={(e) => setRuleSymbol(e.target.value)}
                  className="mt-1 block font-mono bg-surface-raised border border-border rounded-md px-2.5 py-1.5 text-sm"
                >
                  <option value="">Select…</option>
                  {symbols.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-muted-fg">Rule</span>
                <select
                  value={ruleType}
                  onChange={(e) => setRuleType(e.target.value as RuleRow["rule_type"])}
                  className="mt-1 block bg-surface-raised border border-border rounded-md px-2.5 py-1.5 text-sm"
                >
                  {RULE_TYPES.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              {RULE_TYPES.find((t) => t.key === ruleType)?.needsThreshold && (
                <label className="block">
                  <span className="text-xs text-muted-fg">
                    {ruleType === "volume_hourly" ? "Volume threshold" : "Price (₹)"}
                  </span>
                  <input
                    value={ruleThreshold}
                    onChange={(e) => setRuleThreshold(e.target.value)}
                    type="number"
                    min="0"
                    step="any"
                    className="mt-1 block w-36 font-mono bg-surface-raised border border-border rounded-md px-2.5 py-1.5 text-sm"
                  />
                </label>
              )}
              <button
                type="submit"
                disabled={savingRule}
                className="btn-primary hover:btn-primary-hover text-xs disabled:opacity-60"
              >
                Add rule
              </button>
            </form>

            {rules.length > 0 && (
              <table className="data w-full text-sm mt-4">
                <thead className="text-[11px] uppercase tracking-widest text-faint">
                  <tr className="border-b border-border">
                    <th className="text-left px-2 py-1.5 font-medium">Symbol</th>
                    <th className="text-left px-2 py-1.5 font-medium">Rule</th>
                    <th className="num px-2 py-1.5 font-medium">Threshold</th>
                    <th className="text-left px-2 py-1.5 font-medium">Last fired</th>
                    <th className="text-right px-2 py-1.5 font-medium">Active</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-0">
                      <td className="px-2 py-1.5 font-mono">{r.symbol}</td>
                      <td className="px-2 py-1.5 text-muted-fg">
                        {RULE_TYPES.find((t) => t.key === r.rule_type)?.label}
                      </td>
                      <td className="num px-2 py-1.5">{r.threshold ?? "—"}</td>
                      <td className="px-2 py-1.5 text-faint text-xs font-mono">
                        {r.last_fired_candle ? istTime(r.last_fired_candle) : "never"}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <span className="inline-flex items-center gap-2">
                          <button
                            onClick={() => toggleRule(r)}
                            className={
                              "text-xs px-2 py-0.5 rounded border " +
                              (r.is_active
                                ? "border-accent-info text-foreground bg-accent-info/15"
                                : "border-border text-faint")
                            }
                          >
                            {r.is_active ? "on" : "off"}
                          </button>
                          <button
                            onClick={() => deleteRule(r)}
                            className="text-muted-fg hover:text-bearish p-1"
                            title="Delete rule"
                          >
                            <Trash2 size={13} />
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* Inbox */}
          <section className="space-y-2">
            <h2 className="text-[11px] text-faint uppercase tracking-widest">
              Inbox {unread > 0 && <span className="text-foreground">· {unread} unread</span>}
            </h2>
            {loading ? (
              <div className="text-sm text-muted-fg">Loading…</div>
            ) : sorted.length === 0 ? (
              <div className="surface p-8 text-center">
                <p className="text-sm text-muted-fg">
                  No alerts yet. Rules fire once per candle; discipline alerts arrive on
                  their own.
                </p>
              </div>
            ) : (
              sorted.map((a) => {
                const pinned = isPinned(a);
                return (
                  <div
                    key={a.id}
                    className={
                      "surface p-3 " +
                      (pinned
                        ? "border-bearish/60 bg-bearish/10"
                        : a.severity === "warning"
                          ? "border-warning/40"
                          : "") +
                      (a.read_at == null ? "" : " opacity-60")
                    }
                  >
                    <div className="flex items-start gap-2.5">
                      {a.severity !== "info" && (
                        <AlertTriangle
                          size={14}
                          className={
                            "mt-0.5 shrink-0 " +
                            (a.severity === "critical" ? "text-bearish" : "text-warning")
                          }
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-3">
                          {a.symbol && (
                            <span className="font-mono font-medium text-sm">{a.symbol}</span>
                          )}
                          <span className="text-sm text-foreground">{a.title}</span>
                          <span className="text-[11px] text-faint font-mono ml-auto">
                            {istTime(a.triggered_at)}
                          </span>
                        </div>
                        {a.body && <p className="text-xs text-muted-fg mt-1">{a.body}</p>}
                        {pinned && (
                          <p className="text-[11px] text-bearish mt-1">
                            Pinned while the position remains open beyond its line.
                          </p>
                        )}
                      </div>
                      {!pinned && a.read_at == null && (
                        <button
                          onClick={() => markRead(a)}
                          className="text-[11px] px-2 py-1 rounded border border-border text-muted-fg hover:text-foreground shrink-0"
                        >
                          Mark read
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </section>
        </div>
      </PageBody>
      <DisclaimerFooter />
    </>
  );
}
