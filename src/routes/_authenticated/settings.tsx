import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader, PageBody, DisclaimerFooter } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings · Swing Trade" },
      { name: "description", content: "Kite token, provider selection, and data health." },
    ],
  }),
  component: SettingsScreen,
});

type Provider = "kite" | "manual";

interface KiteMeta {
  updated_at?: string;
}

function SettingsScreen() {
  const [provider, setProvider] = useState<Provider>("kite");
  const [apiKey, setApiKey] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [tokenMeta, setTokenMeta] = useState<KiteMeta | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase
        .from("settings")
        .select("key, value, updated_at")
        .in("key", ["provider", "kite_credentials"]);
      if (!mounted || !data) return;
      for (const row of data) {
        if (row.key === "provider" && row.value?.name) {
          setProvider(row.value.name === "manual" ? "manual" : "kite");
        }
        if (row.key === "kite_credentials" && row.value) {
          setApiKey(row.value.api_key ?? "");
          setAccessToken(row.value.access_token ?? "");
          setTokenMeta({ updated_at: row.updated_at ?? row.value.updated_at });
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function save() {
    setSaving(true);
    setMsg(null);
    setErr(null);
    try {
      const now = new Date().toISOString();
      const rows = [
        { key: "provider", value: { name: provider } },
        {
          key: "kite_credentials",
          value: { api_key: apiKey, access_token: accessToken, updated_at: now },
        },
      ];
      const { error } = await supabase
        .from("settings")
        .upsert(rows, { onConflict: "user_id,key" });
      if (error) throw error;
      setTokenMeta({ updated_at: now });
      setMsg("Saved.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const tokenAgeHours = tokenMeta?.updated_at
    ? (Date.now() - new Date(tokenMeta.updated_at).getTime()) / 3_600_000
    : null;
  const stale = tokenAgeHours != null && tokenAgeHours > 8;

  return (
    <>
      <PageHeader title="Settings" subtitle="Provider · Kite token · data health" />
      <PageBody>
        <div className="max-w-2xl space-y-6">
          {provider === "kite" && (
            <div
              className={
                "text-xs px-3 py-2 rounded border " +
                (stale
                  ? "bg-warning/10 text-warning border-warning/40"
                  : tokenMeta?.updated_at
                    ? "bg-bullish/10 text-bullish border-bullish/30"
                    : "bg-surface-raised text-muted-fg border-border")
              }
            >
              {tokenMeta?.updated_at
                ? stale
                  ? `Kite access token is ${tokenAgeHours!.toFixed(1)}h old. Kite tokens expire daily — paste a fresh one.`
                  : `Token saved ${new Date(tokenMeta.updated_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`
                : "No Kite access token saved yet."}
            </div>
          )}

          <section className="surface p-5">
            <h2 className="text-sm font-semibold text-foreground">Market data provider</h2>
            <p className="text-xs text-muted-fg mt-1">
              The provider fetches candles for your active symbols. Kite is primary; Manual accepts CSV uploads.
            </p>
            <div className="mt-3 flex gap-2">
              {(["kite", "manual"] as Provider[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setProvider(p)}
                  className={
                    "text-xs px-3 py-1.5 rounded border transition-colors " +
                    (provider === p
                      ? "bg-accent-info/15 border-accent-info text-foreground"
                      : "border-border text-muted-fg hover:text-foreground")
                  }
                >
                  {p === "kite" ? "Kite Connect" : "Manual / CSV"}
                </button>
              ))}
            </div>
          </section>

          <section className="surface p-5">
            <h2 className="text-sm font-semibold text-foreground">Kite credentials</h2>
            <p className="text-xs text-muted-fg mt-1">
              Kite access tokens expire daily. Paste a fresh token each morning.
              Credentials are stored per-user with RLS.
            </p>
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="text-xs text-muted-fg">API key</span>
                <input
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="mt-1 w-full font-mono bg-surface-raised border border-border rounded-md px-3 py-2 text-sm"
                  autoComplete="off"
                />
              </label>
              <label className="block">
                <span className="text-xs text-muted-fg">Access token</span>
                <input
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  className="mt-1 w-full font-mono bg-surface-raised border border-border rounded-md px-3 py-2 text-sm"
                  autoComplete="off"
                />
              </label>
            </div>
          </section>

          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={saving}
              className="btn-primary hover:btn-primary-hover disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save settings"}
            </button>
            {msg && <span className="text-xs text-bullish">{msg}</span>}
            {err && <span className="text-xs text-bearish">{err}</span>}
          </div>

          <section className="surface p-5">
            <h2 className="text-sm font-semibold text-foreground">Data health</h2>
            <p className="text-xs text-muted-fg mt-1">
              Candle ingestion, cron jobs, and provider health checks arrive in Phase 2.
            </p>
          </section>
        </div>
      </PageBody>
      <DisclaimerFooter />
    </>
  );
}
