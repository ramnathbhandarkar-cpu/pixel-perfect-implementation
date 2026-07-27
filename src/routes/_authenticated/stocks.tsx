import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader, PageBody, DisclaimerFooter } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/stocks")({
  head: () => ({
    meta: [
      { title: "Stocks · Swing Trade" },
      { name: "description", content: "Manage your core, advisory, and nifty50 symbol lists." },
    ],
  }),
  component: StocksScreen,
});

type ListType = "core" | "advisory" | "nifty50" | "archived";

interface Stock {
  id: string;
  symbol: string;
  name: string | null;
  sector: string | null;
  list_type: ListType;
  advisory_quarter: string | null;
  entry_reference: number | null;
  is_active: boolean;
  created_at: string;
}

const TABS: { key: ListType; label: string }[] = [
  { key: "core", label: "Core" },
  { key: "advisory", label: "Advisory" },
  { key: "nifty50", label: "Nifty 50" },
  { key: "archived", label: "Archived" },
];

function currentQuarter(): string {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${d.getFullYear()}-Q${q}`;
}

function StocksScreen() {
  const [tab, setTab] = useState<ListType>("core");
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [bulk, setBulk] = useState("");
  const [bulkQuarter, setBulkQuarter] = useState(currentQuarter());
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase
      .from("stocks")
      .select("*")
      .order("symbol", { ascending: true });
    if (error) setErr(error.message);
    setStocks((data as Stock[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  const visible = useMemo(() => stocks.filter((s) => s.list_type === tab), [stocks, tab]);

  async function addBulk() {
    setBusy(true);
    setErr(null);
    try {
      const symbols = bulk
        .split(/[\s,;\n]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      if (!symbols.length) return;
      const rows = symbols.map((symbol) => ({
        symbol,
        list_type: tab === "archived" ? "core" : tab,
        advisory_quarter: tab === "advisory" ? bulkQuarter : null,
        is_active: true,
      }));
      const { error } = await supabase
        .from("stocks")
        .upsert(rows, { onConflict: "user_id,symbol,list_type" });
      if (error) throw error;
      setBulk("");
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function archive(id: string, restore = false) {
    const { error } = await supabase
      .from("stocks")
      .update({ list_type: restore ? "core" : "archived" })
      .eq("id", id);
    if (error) setErr(error.message);
    else refresh();
  }

  async function remove(id: string) {
    if (!confirm("Delete this symbol permanently?")) return;
    const { error } = await supabase.from("stocks").delete().eq("id", id);
    if (error) setErr(error.message);
    else refresh();
  }

  async function updateField(
    id: string,
    patch: Partial<Pick<Stock, "name" | "sector" | "entry_reference" | "advisory_quarter">>,
  ) {
    const { error } = await supabase.from("stocks").update(patch).eq("id", id);
    if (error) setErr(error.message);
    else refresh();
  }

  return (
    <>
      <PageHeader title="Stocks" subtitle="Manage your symbol universe · NSE" />
      <PageBody>
        <div className="flex gap-1 mb-4 border-b border-border">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={
                "px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors " +
                (tab === t.key
                  ? "border-accent-info text-foreground"
                  : "border-transparent text-muted-fg hover:text-foreground")
              }
            >
              {t.label}
              <span className="ml-1.5 text-faint">
                ({stocks.filter((s) => s.list_type === t.key).length})
              </span>
            </button>
          ))}
        </div>

        {tab !== "archived" && (
          <section className="surface p-4 mb-4">
            <h2 className="text-sm font-semibold">Add symbols to {tab}</h2>
            <p className="text-xs text-muted-fg mt-1">
              Paste symbols separated by commas, spaces, or newlines. E.g.{" "}
              <code>RELIANCE, TCS, INFY</code>
            </p>
            <textarea
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              rows={2}
              className="mt-3 w-full font-mono bg-surface-raised border border-border rounded-md px-3 py-2 text-sm"
              placeholder="RELIANCE  HDFCBANK  ITC"
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {tab === "advisory" && (
                <label className="text-xs text-muted-fg flex items-center gap-2">
                  Quarter
                  <input
                    value={bulkQuarter}
                    onChange={(e) => setBulkQuarter(e.target.value)}
                    className="font-mono bg-surface-raised border border-border rounded-md px-2 py-1 text-xs w-24"
                  />
                </label>
              )}
              <button
                onClick={addBulk}
                disabled={busy || !bulk.trim()}
                className="btn-primary hover:btn-primary-hover disabled:opacity-60"
              >
                {busy ? "Adding…" : "Add symbols"}
              </button>
              {err && <span className="text-xs text-bearish">{err}</span>}
            </div>
          </section>
        )}

        {loading ? (
          <div className="text-sm text-muted-fg">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="surface p-8 text-center">
            <p className="text-sm text-muted-fg">
              No symbols in <span className="text-foreground">{tab}</span> yet.
            </p>
          </div>
        ) : (
          <div className="surface overflow-hidden">
            <table className="data w-full text-sm">
              <thead className="text-[11px] uppercase tracking-widest text-faint">
                <tr className="border-b border-border">
                  <th className="text-left px-3 py-2 font-medium">Symbol</th>
                  <th className="text-left px-3 py-2 font-medium">Name</th>
                  <th className="text-left px-3 py-2 font-medium">Sector</th>
                  {tab === "advisory" && (
                    <th className="text-left px-3 py-2 font-medium">Quarter</th>
                  )}
                  <th className="num px-3 py-2 font-medium">Entry ref (₹)</th>
                  <th className="text-right px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => (
                  <tr
                    key={s.id}
                    className="border-b border-border last:border-0 hover:bg-surface-raised"
                  >
                    <td className="px-3 py-2 font-mono font-medium">{s.symbol}</td>
                    <td className="px-3 py-2">
                      <EditableCell
                        value={s.name ?? ""}
                        onCommit={(v) => updateField(s.id, { name: v || null })}
                        placeholder="—"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <EditableCell
                        value={s.sector ?? ""}
                        onCommit={(v) => updateField(s.id, { sector: v || null })}
                        placeholder="—"
                      />
                    </td>
                    {tab === "advisory" && (
                      <td className="px-3 py-2 font-mono">
                        <EditableCell
                          value={s.advisory_quarter ?? ""}
                          onCommit={(v) => updateField(s.id, { advisory_quarter: v || null })}
                          placeholder="—"
                        />
                      </td>
                    )}
                    <td className="num px-3 py-2">
                      <EditableCell
                        value={s.entry_reference == null ? "" : String(s.entry_reference)}
                        onCommit={(v) =>
                          updateField(s.id, {
                            entry_reference: v ? Number(v) : null,
                          })
                        }
                        placeholder="—"
                        align="right"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex items-center gap-1">
                        {tab === "archived" ? (
                          <button
                            onClick={() => archive(s.id, true)}
                            className="text-muted-fg hover:text-foreground p-1"
                            title="Restore to core"
                          >
                            <ArchiveRestore size={14} />
                          </button>
                        ) : (
                          <button
                            onClick={() => archive(s.id)}
                            className="text-muted-fg hover:text-foreground p-1"
                            title="Archive"
                          >
                            <Archive size={14} />
                          </button>
                        )}
                        <button
                          onClick={() => remove(s.id)}
                          className="text-muted-fg hover:text-bearish p-1"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageBody>
      <DisclaimerFooter />
    </>
  );
}

function EditableCell({
  value,
  onCommit,
  placeholder,
  align = "left",
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  align?: "left" | "right";
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v !== value) onCommit(v);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setV(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      placeholder={placeholder}
      className={
        "bg-transparent border border-transparent hover:border-border focus:border-accent-info focus:bg-surface-raised rounded px-1.5 py-0.5 text-sm w-full outline-none " +
        (align === "right" ? "text-right font-mono" : "")
      }
    />
  );
}
