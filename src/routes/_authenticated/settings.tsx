import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader, PageBody, DisclaimerFooter } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { callSwing } from "@/lib/swing-api";

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

interface KiteStatus {
  api_key_masked?: string | null;
  token_updated_at?: string | null;
}

function SettingsScreen() {
  const [provider, setProvider] = useState<Provider>("kite");
  const [apiKey, setApiKey] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [status, setStatus] = useState<KiteStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase
        .from("settings")
        .select("key, value")
        .in("key", ["provider", "kite_status"]);
      if (!mounted || !data) return;
      for (const row of data) {
        if (row.key === "provider" && row.value?.name) {
          setProvider(row.value.name === "manual" ? "manual" : "kite");
        }
        if (row.key === "kite_status" && row.value) {
          setStatus(row.value as KiteStatus);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function saveProvider(p: Provider) {
    setProvider(p);
    const { error } = await supabase
      .from("settings")
      .upsert({ key: "provider", value: { name: p } }, { onConflict: "user_id,key" });
    if (error) setErr(error.message);
  }

  async function saveToken() {
    setSaving(true);
    setMsg(null);
    setErr(null);
    try {
      const r = await callSwing<KiteStatus & { ok: boolean }>("set_kite_token", {
        api_key: apiKey,
        access_token: accessToken,
      });
      setStatus({ api_key_masked: r.api_key_masked, token_updated_at: r.token_updated_at });
      setApiKey("");
      setAccessToken("");
      setMsg("Token saved server-side. The browser never stores it.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function runJob(action: "refresh_candles" | "nightly") {
    setRunning(action);
    setMsg(null);
    setErr(null);
    try {
      const r = await callSwing<Record<string, unknown>>(
        action,
        action === "refresh_candles" ? { force: true } : {},
      );
      setMsg(
        r.skipped
          ? `Skipped: ${String(r.skipped)}`
          : `${action === "refresh_candles" ? "Refresh" : "Nightly job"} done.`,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(null);
    }
  }

  const tokenAgeHours = status?.token_updated_at
    ? (Date.now() - new Date(status.token_updated_at).getTime()) / 3_600_000
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
                  : status?.token_updated_at
                    ? "bg-bullish/10 text-bullish border-bullish/30"
                    : "bg-surface-raised text-muted-fg border-border")
              }
            >
              {status?.token_updated_at
                ? stale
                  ? `Kite access token is ${tokenAgeHours!.toFixed(1)}h old. Kite tokens expire daily — paste a fresh one.`
                  : `Token saved ${new Date(status.token_updated_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`
                : "No Kite access token saved yet."}
            </div>
          )}

          <section className="surface p-5">
            <h2 className="text-sm font-semibold text-foreground">Market data provider</h2>
            <p className="text-xs text-muted-fg mt-1">
              The provider fetches candles for your active symbols. Kite is primary; Manual accepts
              CSV uploads.
            </p>
            <div className="mt-3 flex gap-2">
              {(["kite", "manual"] as Provider[]).map((p) => (
                <button
                  key={p}
                  onClick={() => saveProvider(p)}
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
              Stored server-side only — the browser sends them once and can never read them back.
              Kite tokens expire daily; paste a fresh one each morning.
            </p>
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="text-xs text-muted-fg">
                  API key{" "}
                  {status?.api_key_masked ? (
                    <span className="font-mono text-faint">
                      (saved: {status.api_key_masked} — leave blank to keep)
                    </span>
                  ) : null}
                </span>
                <input
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={status?.api_key_masked ?? ""}
                  className="mt-1 w-full font-mono bg-surface-raised border border-border rounded-md px-3 py-2 text-sm"
                  autoComplete="off"
                />
              </label>
              <label className="block">
                <span className="text-xs text-muted-fg">Access token (today's)</span>
                <input
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  type="password"
                  className="mt-1 w-full font-mono bg-surface-raised border border-border rounded-md px-3 py-2 text-sm"
                  autoComplete="off"
                />
              </label>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={saveToken}
                disabled={saving || !accessToken.trim()}
                className="btn-primary hover:btn-primary-hover disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save token"}
              </button>
              {msg && <span className="text-xs text-bullish">{msg}</span>}
              {err && <span className="text-xs text-bearish">{err}</span>}
            </div>
          </section>

          <section className="surface p-5">
            <h2 className="text-sm font-semibold text-foreground">Data health</h2>
            <p className="text-xs text-muted-fg mt-1">
              Scheduled jobs run server-side: candle refresh every 5 minutes during market hours,
              levels + screener at 15:45 IST. Run either now to test:
            </p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => runJob("refresh_candles")}
                disabled={running !== null}
                className="text-xs px-3 py-1.5 rounded border border-border text-muted-fg hover:text-foreground disabled:opacity-60"
              >
                {running === "refresh_candles" ? "Running…" : "Refresh candles now"}
              </button>
              <button
                onClick={() => runJob("nightly")}
                disabled={running !== null}
                className="text-xs px-3 py-1.5 rounded border border-border text-muted-fg hover:text-foreground disabled:opacity-60"
              >
                {running === "nightly" ? "Running…" : "Run nightly job now"}
              </button>
            </div>
          </section>
        </div>
      </PageBody>
      <DisclaimerFooter />
    </>
  );
}
