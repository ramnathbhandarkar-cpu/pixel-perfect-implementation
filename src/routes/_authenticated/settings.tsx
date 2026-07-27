import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader, PageBody, DisclaimerFooter } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { callSwing, marketDataHint } from "@/lib/swing-api";
import { disablePush, enablePush, pushStatus, sendTestPush, type PushState } from "@/lib/push";
import { EXPORT_TABLES, exportAllJson, exportTableCsv, type ExportTable } from "@/lib/export";
import { ALERT_TYPES, normalisePrefs, type TelegramPrefs } from "@/lib/telegram";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings · Swing Trade" },
      { name: "description", content: "Price source, notifications, exports and data health." },
    ],
  }),
  component: SettingsScreen,
});

type Provider = "yahoo" | "kite" | "manual";

const PROVIDERS: { key: Provider; label: string; blurb: string }[] = [
  {
    key: "yahoo",
    label: "Automatic",
    blurb: "Free public price data. Nothing to log into, nothing to renew.",
  },
  {
    key: "kite",
    label: "Zerodha Kite",
    blurb:
      "Sharper data from your own broker account, but it needs a login each trading morning. If the login has lapsed, prices quietly come from the free source instead.",
  },
  {
    key: "manual",
    label: "CSV only",
    blurb: "Nothing is fetched. You upload price files yourself.",
  },
];

interface TelegramStatus {
  configured: boolean;
  bot_masked: string | null;
  chat_masked: string | null;
  prefs: TelegramPrefs;
}

interface KiteStatus {
  api_key_masked?: string | null;
  token_updated_at?: string | null;
  api_secret_saved?: boolean | null;
  kite_user_id?: string | null;
}

function SettingsScreen() {
  // Automatic by default: the app has to work on a morning when nobody has
  // logged into anything.
  const [provider, setProvider] = useState<Provider>("yahoo");
  const [apiKey, setApiKey] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [status, setStatus] = useState<KiteStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [push, setPush] = useState<PushState | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  const [exportTable, setExportTable] = useState<ExportTable>("positions");
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [apiSecret, setApiSecret] = useState("");
  const [requestToken, setRequestToken] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectMsg, setConnectMsg] = useState<string | null>(null);
  const [tg, setTg] = useState<TelegramStatus | null>(null);
  const [tgToken, setTgToken] = useState("");
  const [tgChat, setTgChat] = useState("");
  const [tgBusy, setTgBusy] = useState(false);
  const [tgMsg, setTgMsg] = useState<string | null>(null);

  const redirectUrl =
    typeof window === "undefined" ? "/kite/callback" : `${window.location.origin}/kite/callback`;

  // Ask the server for the login URL (it holds the api_key) and go there.
  async function connectKite() {
    setConnecting(true);
    setConnectMsg(null);
    setErr(null);
    setMsg(null);
    try {
      const r = await callSwing<{ login_url: string }>("kite_login_url");
      window.location.href = r.login_url;
    } catch (e) {
      setConnectMsg(marketDataHint(e));
      setShowManual(true);
      setConnecting(false);
    }
  }

  async function saveApiPair() {
    setSaving(true);
    setMsg(null);
    setErr(null);
    try {
      const r = await callSwing<{ api_key_masked: string }>("kite_set_api", {
        api_key: apiKey,
        api_secret: apiSecret,
      });
      setStatus((s) => ({
        ...(s ?? {}),
        api_key_masked: r.api_key_masked,
        api_secret_saved: true,
      }));
      setApiKey("");
      setApiSecret("");
      setMsg("API key and secret saved server-side. “Connect Kite” will work now.");
    } catch (e) {
      setErr(marketDataHint(e));
    } finally {
      setSaving(false);
    }
  }

  async function exchangeToken() {
    setSaving(true);
    setMsg(null);
    setErr(null);
    try {
      const r = await callSwing<KiteStatus>("kite_exchange", { request_token: requestToken });
      setStatus(r);
      setRequestToken("");
      setMsg(
        `Connected${r.kite_user_id ? ` as ${r.kite_user_id}` : ""}. Today's token is stored server-side.`,
      );
    } catch (e) {
      setErr(marketDataHint(e));
    } finally {
      setSaving(false);
    }
  }

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
          const name = row.value.name as string;
          setProvider(name === "kite" || name === "manual" ? name : "yahoo");
        }
        if (row.key === "kite_status" && row.value) {
          setStatus(row.value as KiteStatus);
        }
      }
    })();
    void pushStatus().then(setPush);
    // Telegram status comes from the edge function because the credentials
    // are server-side. If the function is unreachable, show it as
    // unconfigured rather than blocking the rest of the screen.
    void callSwing<TelegramStatus>("telegram_status")
      .then((s) => mounted && setTg({ ...s, prefs: normalisePrefs(s.prefs) }))
      .catch(() => {
        if (mounted) {
          setTg({
            configured: false,
            bot_masked: null,
            chat_masked: null,
            prefs: normalisePrefs(null),
          });
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  async function togglePush() {
    setPushBusy(true);
    setPushMsg(null);
    try {
      if (push === "subscribed") {
        await disablePush();
        setPushMsg("Push disabled on this device.");
      } else {
        await enablePush();
        setPushMsg("Push enabled — alerts will arrive even with the app closed.");
      }
      setPush(await pushStatus());
    } catch (e) {
      setPushMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setPushBusy(false);
    }
  }

  async function testPush() {
    setPushBusy(true);
    setPushMsg(null);
    try {
      const sent = await sendTestPush();
      setPushMsg(
        sent > 0
          ? `Test sent to ${sent} device${sent === 1 ? "" : "s"}.`
          : "No subscribed devices.",
      );
    } catch (e) {
      setPushMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setPushBusy(false);
    }
  }

  async function saveTelegram() {
    setTgBusy(true);
    setTgMsg(null);
    try {
      await callSwing("telegram_set", { bot_token: tgToken.trim(), chat_id: tgChat.trim() });
      // The token is proven working server-side before it is stored, so
      // there is nothing left in the browser to clear up later.
      setTgToken("");
      setTgChat("");
      setTg(await callSwing<TelegramStatus>("telegram_status"));
      setTgMsg("Connected — check Telegram for the confirmation message.");
    } catch (e) {
      setTgMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setTgBusy(false);
    }
  }

  async function testTelegram() {
    setTgBusy(true);
    setTgMsg(null);
    try {
      await callSwing("telegram_test");
      setTgMsg("Test message sent.");
    } catch (e) {
      setTgMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setTgBusy(false);
    }
  }

  async function disconnectTelegram() {
    setTgBusy(true);
    setTgMsg(null);
    try {
      await callSwing("telegram_disconnect");
      setTg(await callSwing<TelegramStatus>("telegram_status"));
      setTgMsg("Disconnected.");
    } catch (e) {
      setTgMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setTgBusy(false);
    }
  }

  async function saveTgPrefs(next: TelegramPrefs) {
    // Optimistic: a checkbox that lags behind the finger feels broken.
    setTg((s) => (s ? { ...s, prefs: next } : s));
    const { error } = await supabase
      .from("settings")
      .upsert({ key: "telegram", value: next }, { onConflict: "user_id,key" });
    if (error) {
      setTgMsg(error.message);
      setTg(await callSwing<TelegramStatus>("telegram_status"));
    }
  }

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
      setErr(marketDataHint(e));
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
      <PageHeader title="Settings" subtitle="Where prices come from, how you hear about them" />
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
            <h2 className="text-sm font-semibold text-foreground">Where prices come from</h2>
            <p className="text-xs text-muted-fg mt-1 leading-relaxed">
              Prices for the stocks you follow are collected overnight and during market hours. You
              do not have to change this.
            </p>
            <div className="mt-3 space-y-2">
              {PROVIDERS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => saveProvider(p.key)}
                  className={
                    "w-full text-left px-3 py-2.5 rounded border transition-colors " +
                    (provider === p.key
                      ? "bg-accent-info/10 border-accent-info"
                      : "border-border hover:border-border-strong")
                  }
                >
                  <span className="flex items-baseline gap-2">
                    <span
                      className={
                        "text-sm " + (provider === p.key ? "text-foreground" : "text-muted-fg")
                      }
                    >
                      {p.label}
                    </span>
                    {p.key === "yahoo" && (
                      <span className="text-[10px] text-faint uppercase tracking-widest">
                        default
                      </span>
                    )}
                  </span>
                  <span className="block text-xs text-muted-fg mt-1 leading-relaxed">
                    {p.blurb}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {/* Daily connect — one tap, no token handling */}
          <section className="surface p-5">
            <h2 className="text-sm font-semibold text-foreground">Connect to Kite</h2>
            <p className="text-xs text-muted-fg mt-1">
              Kite access tokens last one trading day and Zerodha issues no refresh token, so the
              login has to happen once each morning. This is the whole of it: tap Connect,
              authenticate on Zerodha's own page, and the token is exchanged and stored server-side
              automatically. You never copy a token.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={connectKite}
                disabled={connecting}
                className="btn-primary hover:btn-primary-hover disabled:opacity-60"
              >
                {connecting ? "Opening Kite…" : "Connect Kite"}
              </button>
              <button
                onClick={() => setShowManual((v) => !v)}
                className="text-xs px-3 py-1.5 rounded border border-border text-muted-fg hover:text-foreground"
              >
                {showManual ? "Hide manual options" : "Manual options"}
              </button>
              {connectMsg && <span className="text-xs text-bearish">{connectMsg}</span>}
            </div>

            {showManual && (
              <div className="mt-4 space-y-4 border-t border-border pt-4">
                <div>
                  <h3 className="text-xs font-semibold text-foreground">
                    Paste the redirect URL or request_token
                  </h3>
                  <p className="text-[11px] text-muted-fg mt-1">
                    Use this if the redirect lands somewhere else — copy the whole address you were
                    sent to (or just the <code>request_token</code> from it). The exchange still
                    happens server-side, so no Python and no api_secret in the browser.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <input
                      value={requestToken}
                      onChange={(e) => setRequestToken(e.target.value)}
                      placeholder="https://…/kite/callback?request_token=abc123&action=login"
                      className="flex-1 font-mono bg-surface-raised border border-border rounded-md px-2.5 py-1.5 text-xs"
                      autoComplete="off"
                    />
                    <button
                      onClick={exchangeToken}
                      disabled={saving || !requestToken.trim()}
                      className="text-xs px-3 py-1.5 rounded border border-border text-muted-fg hover:text-foreground disabled:opacity-60"
                    >
                      Exchange
                    </button>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-semibold text-foreground">API key and secret</h3>
                  <p className="text-[11px] text-muted-fg mt-1">
                    Set once, from your Kite Connect app. Stored server-side and never readable by
                    the browser.
                    {status?.api_secret_saved ? " A secret is currently saved." : ""}
                  </p>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder={status?.api_key_masked ?? "api_key"}
                      className="font-mono bg-surface-raised border border-border rounded-md px-2.5 py-1.5 text-xs"
                      autoComplete="off"
                    />
                    <input
                      value={apiSecret}
                      onChange={(e) => setApiSecret(e.target.value)}
                      placeholder="api_secret"
                      type="password"
                      className="font-mono bg-surface-raised border border-border rounded-md px-2.5 py-1.5 text-xs"
                      autoComplete="off"
                    />
                  </div>
                  <button
                    onClick={saveApiPair}
                    disabled={saving || !apiKey.trim() || !apiSecret.trim()}
                    className="mt-2 text-xs px-3 py-1.5 rounded border border-border text-muted-fg hover:text-foreground disabled:opacity-60"
                  >
                    Save key and secret
                  </button>
                </div>

                <div>
                  <h3 className="text-xs font-semibold text-foreground">
                    Paste today's access token directly
                  </h3>
                  <p className="text-[11px] text-muted-fg mt-1">
                    The old way, kept as a last resort if you already have a token in hand.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <input
                      value={accessToken}
                      onChange={(e) => setAccessToken(e.target.value)}
                      type="password"
                      placeholder="access_token"
                      className="flex-1 font-mono bg-surface-raised border border-border rounded-md px-2.5 py-1.5 text-xs"
                      autoComplete="off"
                    />
                    <button
                      onClick={saveToken}
                      disabled={saving || !accessToken.trim()}
                      className="text-xs px-3 py-1.5 rounded border border-border text-muted-fg hover:text-foreground disabled:opacity-60"
                    >
                      Save token
                    </button>
                  </div>
                </div>

                <p className="text-[11px] text-faint">
                  For one-tap Connect to work, the redirect URL on your Kite Connect app must be{" "}
                  <code className="text-muted-fg">{redirectUrl}</code>.
                </p>
              </div>
            )}

            <div className="mt-3 flex items-center gap-3">
              {msg && <span className="text-xs text-bullish">{msg}</span>}
              {err && <span className="text-xs text-bearish whitespace-pre-wrap">{err}</span>}
            </div>
          </section>

          <section className="surface p-5">
            <h2 className="text-sm font-semibold text-foreground">Is the data fresh?</h2>
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

          {/* Telegram — the channel he actually reads. */}
          <section className="surface p-5">
            <h2 className="text-sm font-semibold text-foreground">Telegram</h2>
            <p className="text-xs text-muted-fg mt-1 leading-relaxed">
              Alerts can arrive in Telegram as well as on this device. Create a bot with{" "}
              <span className="font-mono">@BotFather</span>, send it any message, then paste its
              token and your chat id below. Both are stored on the server — the app in your browser
              never sees them.
            </p>

            {tg?.configured ? (
              <div className="mt-3 text-xs text-muted-fg font-mono">
                Connected · bot {tg.bot_masked} · chat {tg.chat_masked}
              </div>
            ) : (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs text-muted-fg">Bot token</span>
                  <input
                    value={tgToken}
                    onChange={(e) => setTgToken(e.target.value)}
                    type="password"
                    autoComplete="off"
                    placeholder="123456:ABC-DEF…"
                    className="mt-1 w-full font-mono bg-surface-raised border border-border rounded-md px-2.5 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-muted-fg">Chat id</span>
                  <input
                    value={tgChat}
                    onChange={(e) => setTgChat(e.target.value)}
                    autoComplete="off"
                    placeholder="e.g. 87654321"
                    className="mt-1 w-full font-mono bg-surface-raised border border-border rounded-md px-2.5 py-2 text-sm"
                  />
                </label>
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {!tg?.configured ? (
                <button
                  onClick={saveTelegram}
                  disabled={tgBusy || !tgToken.trim() || !tgChat.trim()}
                  className="btn-primary hover:btn-primary-hover text-xs disabled:opacity-60"
                >
                  {tgBusy ? "Connecting…" : "Connect Telegram"}
                </button>
              ) : (
                <>
                  <button
                    onClick={testTelegram}
                    disabled={tgBusy}
                    className="text-xs px-3 py-1.5 rounded border border-border text-muted-fg hover:text-foreground disabled:opacity-60"
                  >
                    Send a test message
                  </button>
                  <button
                    onClick={disconnectTelegram}
                    disabled={tgBusy}
                    className="text-xs px-3 py-1.5 rounded border border-border text-muted-fg hover:text-bearish disabled:opacity-60"
                  >
                    Disconnect
                  </button>
                </>
              )}
              {tgMsg && <span className="text-xs text-muted-fg">{tgMsg}</span>}
            </div>

            {tg?.configured && (
              <div className="mt-4 border-t border-border pt-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={tg.prefs.enabled}
                    onChange={(e) => saveTgPrefs({ ...tg.prefs, enabled: e.target.checked })}
                    className="accent-[var(--accent-info)]"
                  />
                  <span className="text-foreground">Send alerts to Telegram</span>
                </label>

                <div
                  className={
                    "mt-3 space-y-2.5 transition-opacity " + (tg.prefs.enabled ? "" : "opacity-40")
                  }
                >
                  {ALERT_TYPES.map((t) => (
                    <label key={t.key} className="flex items-start gap-2.5">
                      <input
                        type="checkbox"
                        disabled={!tg.prefs.enabled || t.locked}
                        checked={t.locked ? true : tg.prefs.types[t.key] === true}
                        onChange={(e) =>
                          saveTgPrefs({
                            ...tg.prefs,
                            types: { ...tg.prefs.types, [t.key]: e.target.checked },
                          })
                        }
                        className="mt-0.5 accent-[var(--accent-info)]"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm text-foreground">{t.label}</span>
                        <span className="block text-xs text-muted-fg leading-relaxed">
                          {t.blurb}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="surface p-5">
            <h2 className="text-sm font-semibold text-foreground">Notifications on this device</h2>
            <p className="text-xs text-muted-fg mt-1 leading-relaxed">
              Alerts can also arrive as a phone or desktop notification while the app is closed.
              This is per-device, so turn it on wherever you want to be reachable.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={togglePush}
                disabled={pushBusy || push === "unsupported" || push === "denied"}
                className="btn-primary hover:btn-primary-hover text-xs disabled:opacity-60"
              >
                {push === "subscribed"
                  ? "Disable push on this device"
                  : "Enable push on this device"}
              </button>
              {push === "subscribed" && (
                <button
                  onClick={testPush}
                  disabled={pushBusy}
                  className="text-xs px-3 py-1.5 rounded border border-border text-muted-fg hover:text-foreground disabled:opacity-60"
                >
                  Send test notification
                </button>
              )}
              {push === "unsupported" && (
                <span className="text-xs text-faint">This browser does not support Web Push.</span>
              )}
              {push === "denied" && (
                <span className="text-xs text-warning">
                  Notifications are blocked for this site — allow them in the browser settings.
                </span>
              )}
              {pushMsg && <span className="text-xs text-muted-fg">{pushMsg}</span>}
            </div>
          </section>

          <section className="surface p-5">
            <h2 className="text-sm font-semibold text-foreground">Take your data with you</h2>
            <p className="text-xs text-muted-fg mt-1">
              Your data leaves whenever you want it to — positions, plans, discipline events,
              screener history, journal, everything.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={async () => {
                  setExporting(true);
                  setExportMsg(null);
                  try {
                    await exportAllJson();
                    setExportMsg("JSON downloaded.");
                  } catch (e) {
                    setExportMsg(e instanceof Error ? e.message : String(e));
                  } finally {
                    setExporting(false);
                  }
                }}
                disabled={exporting}
                className="btn-primary hover:btn-primary-hover text-xs disabled:opacity-60"
              >
                {exporting ? "Exporting…" : "Download everything (JSON)"}
              </button>
              <select
                value={exportTable}
                onChange={(e) => setExportTable(e.target.value as ExportTable)}
                className="bg-surface-raised border border-border rounded-md px-2.5 py-1.5 text-xs font-mono"
              >
                {EXPORT_TABLES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <button
                onClick={async () => {
                  setExporting(true);
                  setExportMsg(null);
                  try {
                    await exportTableCsv(exportTable);
                    setExportMsg("CSV downloaded.");
                  } catch (e) {
                    setExportMsg(e instanceof Error ? e.message : String(e));
                  } finally {
                    setExporting(false);
                  }
                }}
                disabled={exporting}
                className="text-xs px-3 py-1.5 rounded border border-border text-muted-fg hover:text-foreground disabled:opacity-60"
              >
                Download CSV
              </button>
              {exportMsg && <span className="text-xs text-muted-fg">{exportMsg}</span>}
            </div>
          </section>
        </div>
      </PageBody>
      <DisclaimerFooter />
    </>
  );
}
