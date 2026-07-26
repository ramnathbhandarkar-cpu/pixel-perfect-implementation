// Supabase Edge Function: swing
//
// All Kite Connect calls and the scheduled data pipeline live here,
// server-side, using the service-role key (auto-injected env). Kite
// credentials sit in public.server_secrets — RLS deny-all, service-role
// only — so the browser can never read them (Task 0a).
//
// Callers:
//   - pg_cron via net.http_post with the x-ingest-secret header
//     (actions: refresh_candles, nightly)
//   - the app with a signed-in user's JWT (all actions)
//
// Deployed with verify_jwt disabled; this function does its own auth.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { computeLevels, type DailyCandle } from "./levels-engine.ts";
import { runScreener, type ScreenerInput } from "./screener-engine.ts";

type Timeframe = "15m" | "1h" | "1d" | "1wk";
const KITE_INTERVAL: Record<Timeframe, string> = {
  "15m": "15minute",
  "1h": "60minute",
  "1d": "day",
  "1wk": "week",
};
// Providers throttle parallel bursts and return empty arrays that look like
// "no data" rather than errors — space calls out instead.
const SPACING_MS = 350;
const LEVELS_METHOD = "swing_pivot_1y";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-ingest-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });

const db: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── secrets (server_secrets: RLS deny-all, service role only) ──

async function getSecret(key: string): Promise<Record<string, string> | null> {
  const { data, error } = await db
    .from("server_secrets")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(`Secret read failed: ${error.message}`);
  return (data?.value as Record<string, string>) ?? null;
}

async function setSecret(key: string, value: Record<string, string>): Promise<void> {
  const { error } = await db
    .from("server_secrets")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(`Secret write failed: ${error.message}`);
}

// ── caller auth ──────────────────────────────────────────────

type CallerRole = "cron" | "user";

async function callerRole(req: Request): Promise<CallerRole | null> {
  const provided = req.headers.get("x-ingest-secret");
  if (provided) {
    const s = await getSecret("ingest_secret");
    if (s?.value && provided === s.value) return "cron";
    return null;
  }
  const authz = req.headers.get("authorization") ?? "";
  const token = authz.replace(/^Bearer\s+/i, "");
  if (token) {
    const { data, error } = await db.auth.getUser(token);
    if (!error && data.user) return "user";
  }
  return null;
}

// Single-account app: rows are stamped with the owner's uid so RLS
// (user_id = auth.uid()) lets the client read what the pipeline writes.
async function ownerUid(): Promise<string | null> {
  const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 1 });
  return data?.users?.[0]?.id ?? null;
}

// ── IST helpers ──────────────────────────────────────────────

function istDateString(d: Date = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function istMarketOpenNow(d: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday");
  if (weekday === "Sat" || weekday === "Sun") return false;
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  return minutes >= 9 * 60 + 5 && minutes <= 15 * 60 + 40;
}

// ── Kite Connect ─────────────────────────────────────────────

interface KiteCreds {
  api_key: string;
  access_token: string;
}

async function kiteCreds(): Promise<KiteCreds> {
  const v = await getSecret("kite_credentials");
  if (!v?.api_key || !v?.access_token) {
    throw new Error("Kite credentials not set. Save them in Settings first.");
  }
  return { api_key: v.api_key, access_token: v.access_token };
}

const kiteHeaders = (c: KiteCreds) => ({
  "X-Kite-Version": "3",
  Authorization: `token ${c.api_key}:${c.access_token}`,
});

function formatIST(d: Date): string {
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  return ist.toISOString().replace("T", " ").slice(0, 19);
}

async function findInstrumentToken(symbol: string): Promise<number> {
  const { data, error } = await db
    .from("instruments")
    .select("instrument_token")
    .eq("tradingsymbol", symbol)
    .eq("exchange", "NSE")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Instrument lookup failed: ${error.message}`);
  if (!data) throw new Error(`Instrument not found for ${symbol}. Run "Sync instruments".`);
  return data.instrument_token as number;
}

interface CandleRow {
  user_id: string | null;
  symbol: string;
  timeframe: Timeframe;
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

async function fetchKiteCandles(
  symbol: string,
  timeframe: Timeframe,
  days: number,
  creds: KiteCreds,
  uid: string | null,
): Promise<CandleRow[]> {
  const token = await findInstrumentToken(symbol);
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400 * 1000);
  const url =
    `https://api.kite.trade/instruments/historical/${token}/${KITE_INTERVAL[timeframe]}` +
    `?from=${encodeURIComponent(formatIST(from))}&to=${encodeURIComponent(formatIST(to))}`;
  const res = await fetch(url, { headers: kiteHeaders(creds) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kite historical fetch failed (${res.status}): ${text.slice(0, 250)}`);
  }
  const body = (await res.json()) as {
    status: string;
    data?: { candles?: Array<[string, number, number, number, number, number]> };
    message?: string;
  };
  if (body.status !== "success" || !body.data?.candles) {
    throw new Error(`Kite response: ${body.message ?? "no candles"}`);
  }
  return body.data.candles.map((row) => ({
    user_id: uid,
    symbol,
    timeframe,
    ts: new Date(row[0]).toISOString(),
    open: row[1],
    high: row[2],
    low: row[3],
    close: row[4],
    volume: row[5],
  }));
}

async function upsertCandles(rows: CandleRow[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await db
      .from("candles")
      .upsert(chunk, { onConflict: "user_id,symbol,timeframe,ts" });
    if (error) throw new Error(`Candles upsert failed: ${error.message}`);
    n += chunk.length;
  }
  return n;
}

// ── shared data access ───────────────────────────────────────

interface ActiveStock {
  symbol: string;
  sector: string | null;
}

async function loadActiveStocks(): Promise<ActiveStock[]> {
  const { data, error } = await db
    .from("stocks")
    .select("symbol, sector, list_type, is_active")
    .neq("list_type", "archived")
    .eq("is_active", true)
    .order("symbol", { ascending: true });
  if (error) throw new Error(`Load stocks failed: ${error.message}`);
  const bySymbol = new Map<string, ActiveStock>();
  for (const row of data ?? []) {
    const existing = bySymbol.get(row.symbol as string);
    if (!existing) {
      bySymbol.set(row.symbol as string, {
        symbol: row.symbol as string,
        sector: (row.sector as string | null) ?? null,
      });
    } else if (!existing.sector && row.sector) existing.sector = row.sector as string;
  }
  return [...bySymbol.values()];
}

async function loadDailyCandles(symbol: string): Promise<DailyCandle[]> {
  const cutoff = new Date(Date.now() - 380 * 86400 * 1000).toISOString();
  const { data, error } = await db
    .from("candles")
    .select("ts, open, high, low, close, volume")
    .eq("symbol", symbol)
    .eq("timeframe", "1d")
    .gte("ts", cutoff)
    .order("ts", { ascending: true })
    .limit(400);
  if (error) throw new Error(`Load candles failed for ${symbol}: ${error.message}`);
  return (data ?? []).map((r) => ({
    time: Math.floor(new Date(r.ts as string).getTime() / 1000),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: r.volume == null ? null : Number(r.volume),
  }));
}

async function insertAlert(
  uid: string | null,
  alert: {
    symbol?: string | null;
    alert_type: string;
    severity: "info" | "warning" | "critical";
    title: string;
    body: string;
    payload?: unknown;
  },
): Promise<void> {
  const { error } = await db.from("alerts").insert({
    user_id: uid,
    symbol: alert.symbol ?? null,
    alert_type: alert.alert_type,
    severity: alert.severity,
    title: alert.title,
    body: alert.body,
    triggered_at: new Date().toISOString(),
    payload: alert.payload ?? null,
  });
  if (error) console.error(`Alert insert failed: ${error.message}`);
  // Web Push so alerts arrive with the app closed. Best-effort; the inbox
  // row above is the source of truth.
  try {
    await sendPushToAll({
      title: alert.symbol ? `${alert.symbol} — ${alert.title}` : alert.title,
      body: alert.body,
      severity: alert.severity,
    });
  } catch (e) {
    console.error(`Push send failed: ${e instanceof Error ? e.message : e}`);
  }
}

// ── Web Push (VAPID keys live in server_secrets.vapid) ───────

async function vapidConfig(): Promise<{ publicKey: string; privateKey: string; subject: string } | null> {
  const v = await getSecret("vapid");
  if (!v?.public_key || !v?.private_key) return null;
  return {
    publicKey: v.public_key,
    privateKey: v.private_key,
    subject: v.subject ?? "mailto:owner@example.com",
  };
}

async function sendPushToAll(payload: { title: string; body: string; severity: string }): Promise<number> {
  const cfg = await vapidConfig();
  if (!cfg) return 0; // push not configured — silently skip
  const { data: subs, error } = await db
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth");
  if (error || !subs?.length) return 0;
  webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: s.endpoint as string,
          keys: { p256dh: s.p256dh as string, auth: s.auth as string },
        },
        JSON.stringify(payload),
        { TTL: 3600 },
      );
      sent += 1;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await db.from("push_subscriptions").delete().eq("id", s.id);
      } else {
        console.error(`Push to ${String(s.endpoint).slice(0, 40)}… failed: ${status ?? e}`);
      }
    }
  }
  return sent;
}

// ── Phase 5: alert-rule evaluation (fires once per candle) ───

function istHourBucket(tsIso: string): number {
  const t = new Date(tsIso).getTime() + 5.5 * 3600 * 1000;
  return t - (t % 3_600_000) - 5.5 * 3600 * 1000;
}

async function evaluateAlertRules(uid: string | null): Promise<{ fired: number }> {
  const { data: rules, error } = await db.from("alert_rules").select("*").eq("is_active", true);
  if (error) throw new Error(`Load alert rules failed: ${error.message}`);
  if (!rules?.length) return { fired: 0 };

  const symbols = [...new Set(rules.map((r) => r.symbol as string))];
  const [candlesRes, levelsRes] = await Promise.all([
    db
      .from("candles")
      .select("symbol, ts, close, volume")
      .eq("timeframe", "15m")
      .in("symbol", symbols)
      .gte("ts", new Date(Date.now() - 3 * 86400 * 1000).toISOString())
      .order("ts", { ascending: true })
      .limit(3000),
    db
      .from("levels")
      .select("symbol, as_of, support, resistance, support_tests, resistance_tests")
      .in("symbol", symbols)
      .order("as_of", { ascending: false })
      .limit(500),
  ]);
  const bySymbol = new Map<string, { ts: string; close: number; volume: number | null }[]>();
  for (const row of candlesRes.data ?? []) {
    const list = bySymbol.get(row.symbol as string) ?? [];
    list.push({
      ts: row.ts as string,
      close: Number(row.close),
      volume: row.volume == null ? null : Number(row.volume),
    });
    bySymbol.set(row.symbol as string, list);
  }
  const latestLevel = new Map<string, Record<string, unknown>>();
  for (const row of levelsRes.data ?? []) {
    if (!latestLevel.has(row.symbol as string)) latestLevel.set(row.symbol as string, row);
  }

  let fired = 0;
  for (const rule of rules) {
    const candles = bySymbol.get(rule.symbol as string) ?? [];
    if (candles.length === 0) continue;
    const last = candles[candles.length - 1];
    const prev = candles.length > 1 ? candles[candles.length - 2] : null;
    const lastFired = rule.last_fired_candle ? new Date(rule.last_fired_candle as string).getTime() : null;

    if (rule.rule_type === "volume_hourly" && rule.threshold != null) {
      const bucket = istHourBucket(last.ts);
      if (lastFired === bucket) continue; // once per (hourly) candle
      const vol = candles
        .filter((c) => istHourBucket(c.ts) === bucket)
        .reduce((s, c) => s + (c.volume ?? 0), 0);
      if (vol >= Number(rule.threshold)) {
        await insertAlertNoPushLoop(uid, {
          symbol: rule.symbol as string,
          alert_type: "volume_hourly",
          severity: "info",
          title: `Hourly volume ${vol.toLocaleString("en-IN")} crossed ${Number(rule.threshold).toLocaleString("en-IN")}`,
          body: "Volume spike ≠ direction. Wait for the close.",
          payload: { rule_id: rule.id, candle: new Date(bucket).toISOString() },
        });
        await db
          .from("alert_rules")
          .update({ last_fired_candle: new Date(bucket).toISOString() })
          .eq("id", rule.id);
        fired += 1;
      }
    } else if (rule.rule_type === "price_target" && rule.threshold != null && prev) {
      const candleTs = new Date(last.ts).getTime();
      if (lastFired === candleTs) continue;
      const thr = Number(rule.threshold);
      const crossedUp = prev.close < thr && last.close >= thr;
      const crossedDown = prev.close > thr && last.close <= thr;
      if (crossedUp || crossedDown) {
        await insertAlertNoPushLoop(uid, {
          symbol: rule.symbol as string,
          alert_type: "price_target",
          severity: "info",
          title: `Price crossed ₹${thr} (now ₹${last.close})`,
          body: `Close moved ${crossedUp ? "above" : "below"} your marker of ₹${thr}.`,
          payload: { rule_id: rule.id, candle: last.ts },
        });
        await db.from("alert_rules").update({ last_fired_candle: last.ts }).eq("id", rule.id);
        fired += 1;
      }
    } else if (rule.rule_type === "level_cross" && prev) {
      const candleTs = new Date(last.ts).getTime();
      if (lastFired === candleTs) continue;
      const level = latestLevel.get(rule.symbol as string);
      if (!level) continue;
      const support = level.support == null ? null : Number(level.support);
      const resistance = level.resistance == null ? null : Number(level.resistance);
      let text: string | null = null;
      if (support != null && prev.close >= support && last.close < support) {
        text = `Close ₹${last.close} moved below support ₹${support} (tested ${level.support_tests}×).`;
      } else if (resistance != null && prev.close <= resistance && last.close > resistance) {
        text = `Close ₹${last.close} moved above resistance ₹${resistance} (tested ${level.resistance_tests}×).`;
      }
      if (text) {
        await insertAlertNoPushLoop(uid, {
          symbol: rule.symbol as string,
          alert_type: "level_cross",
          severity: "warning",
          title: "Level crossed",
          body: `${text} A cross describes where price is, not where it goes next.`,
          payload: { rule_id: rule.id, candle: last.ts },
        });
        await db.from("alert_rules").update({ last_fired_candle: last.ts }).eq("id", rule.id);
        fired += 1;
      }
    }
  }
  return { fired };
}

// insertAlert wrapper used by the rule loop (kept separate so a future
// batching change cannot accidentally re-alert inside one candle).
async function insertAlertNoPushLoop(
  uid: string | null,
  alert: Parameters<typeof insertAlert>[1],
): Promise<void> {
  await insertAlert(uid, alert);
}

const round2 = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);

// ── levels ───────────────────────────────────────────────────

async function computeAndStoreLevels(uid: string | null, stocks: ActiveStock[]) {
  const asOf = istDateString();
  const summary = {
    asOf,
    computed: [] as string[],
    skippedInsufficientData: [] as string[],
    failed: [] as { symbol: string; error: string }[],
  };
  for (const stock of stocks) {
    try {
      const candles = await loadDailyCandles(stock.symbol);
      const lv = computeLevels(candles);
      if (!lv) {
        summary.skippedInsufficientData.push(stock.symbol);
        continue;
      }
      const del = await db.from("levels").delete().eq("symbol", stock.symbol).eq("as_of", asOf);
      if (del.error) throw new Error(del.error.message);
      const ins = await db.from("levels").insert({
        user_id: uid,
        symbol: stock.symbol,
        as_of: asOf,
        support: round2(lv.support),
        resistance: round2(lv.resistance),
        support_tests: lv.supportTests,
        resistance_tests: lv.resistanceTests,
        trend_context: lv.trendContext,
        is_downtrend: lv.isDowntrend,
        method: LEVELS_METHOD,
      });
      if (ins.error) throw new Error(ins.error.message);
      summary.computed.push(stock.symbol);
    } catch (e) {
      summary.failed.push({
        symbol: stock.symbol,
        error: String(e instanceof Error ? e.message : e),
      });
    }
  }
  return summary;
}

// ── screener ─────────────────────────────────────────────────

async function buildScreenerInputs(stocks: ActiveStock[]) {
  const symbols = stocks.map((s) => s.symbol);
  if (symbols.length === 0) return { inputs: [] as ScreenerInput[], missingData: [] as string[] };
  const [levelsRes, closesRes] = await Promise.all([
    db
      .from("levels")
      .select(
        "symbol, as_of, support, resistance, support_tests, resistance_tests, trend_context, is_downtrend",
      )
      .in("symbol", symbols)
      .order("as_of", { ascending: false })
      .limit(2000),
    db
      .from("candles")
      .select("symbol, ts, close")
      .eq("timeframe", "1d")
      .in("symbol", symbols)
      .gte("ts", new Date(Date.now() - 21 * 86400 * 1000).toISOString())
      .order("ts", { ascending: false })
      .limit(5000),
  ]);
  if (levelsRes.error) throw new Error(`Load levels failed: ${levelsRes.error.message}`);
  if (closesRes.error) throw new Error(`Load closes failed: ${closesRes.error.message}`);
  const latestLevel = new Map<string, Record<string, unknown>>();
  for (const row of levelsRes.data ?? []) {
    if (!latestLevel.has(row.symbol as string)) latestLevel.set(row.symbol as string, row);
  }
  const latestClose = new Map<string, { close: number; ts: string }>();
  for (const row of closesRes.data ?? []) {
    if (!latestClose.has(row.symbol as string)) {
      latestClose.set(row.symbol as string, { close: Number(row.close), ts: row.ts as string });
    }
  }
  const inputs: ScreenerInput[] = [];
  const missingData: string[] = [];
  for (const stock of stocks) {
    const level = latestLevel.get(stock.symbol);
    const close = latestClose.get(stock.symbol);
    if (!level || !close) {
      missingData.push(stock.symbol);
      continue;
    }
    inputs.push({
      symbol: stock.symbol,
      sector: stock.sector,
      price: close.close,
      priceAsOf: close.ts,
      support: level.support == null ? null : Number(level.support),
      supportTests: Number(level.support_tests ?? 0),
      resistance: level.resistance == null ? null : Number(level.resistance),
      resistanceTests: Number(level.resistance_tests ?? 0),
      trendContext: (level.trend_context as string | null) ?? null,
      isDowntrend: Boolean(level.is_downtrend),
      levelAsOf: level.as_of as string,
    });
  }
  return { inputs, missingData };
}

async function runAndStoreScreener(uid: string | null, stocks: ActiveStock[]) {
  const { inputs, missingData } = await buildScreenerInputs(stocks);
  const result = runScreener(inputs);
  const runDate = istDateString();
  const qualifyingJson = result.qualifying.map((q) => ({
    symbol: q.symbol,
    sector: q.sector,
    price: q.price,
    price_as_of: q.priceAsOf ?? null,
    support: q.support,
    support_tests: q.supportTests,
    resistance: q.resistance,
    resistance_tests: q.resistanceTests,
    risk: round2(q.risk),
    reward: round2(q.reward),
    ratio: q.ratio == null ? null : Math.round(q.ratio * 100) / 100,
    risk_pct: q.riskPct == null ? null : Math.round(q.riskPct * 100) / 100,
    score: q.score == null ? null : Math.round(q.score * 1000) / 1000,
    trend_context: q.trendContext,
    is_downtrend: q.isDowntrend,
  }));
  const del = await db.from("screener_runs").delete().eq("run_date", runDate);
  if (del.error) throw new Error(`Screener run delete failed: ${del.error.message}`);
  const ins = await db.from("screener_runs").insert({
    user_id: uid,
    run_date: runDate,
    ran_at: new Date().toISOString(),
    qualifying: qualifyingJson,
    rejected_thin_support: result.rejectedThinSupport,
    rejected_geometry: result.rejectedGeometry,
    rejected_risk_band: result.rejectedRiskBand,
    scanned: result.scanned,
    failed: missingData.length,
  });
  if (ins.error) throw new Error(`Screener run insert failed: ${ins.error.message}`);
  return { runDate, result, missingData };
}

// ── candle refresh (rate-limited, zero-row safe) ─────────────

async function refreshCandles(
  uid: string | null,
  stocks: ActiveStock[],
  jobs: { timeframe: Timeframe; days: number }[],
) {
  const creds = await kiteCreds();
  const summary = {
    fetched: {} as Record<string, number>,
    totalRows: 0,
    errors: [] as { symbol: string; error: string }[],
    allZero: false,
  };
  for (const stock of stocks) {
    let rowsForSymbol = 0;
    for (const job of jobs) {
      try {
        const rows = await fetchKiteCandles(stock.symbol, job.timeframe, job.days, creds, uid);
        if (rows.length > 0) {
          await upsertCandles(rows);
          rowsForSymbol += rows.length;
        }
      } catch (e) {
        summary.errors.push({
          symbol: stock.symbol,
          error: String(e instanceof Error ? e.message : e),
        });
      }
      await sleep(SPACING_MS);
    }
    summary.fetched[stock.symbol] = rowsForSymbol;
    summary.totalRows += rowsForSymbol;
  }
  // Zero rows for *all* symbols = provider failure, not "no data".
  // (This exact bug once silently wiped a working dataset.) Callers must
  // alert and leave existing data untouched.
  summary.allZero = stocks.length > 0 && summary.totalRows === 0;
  return summary;
}

// ── Phase 4.3: line-crossed detection ────────────────────────

async function checkLineCrossed(uid: string | null) {
  const { data: open, error } = await db
    .from("positions")
    .select("id, symbol, side, qty, invalidation_at_entry, status")
    .eq("status", "open");
  if (error) throw new Error(`Load open positions failed: ${error.message}`);
  if (!open || open.length === 0) return { checked: 0, breached: [] as string[] };

  const symbols = [...new Set(open.map((p) => p.symbol as string))];
  const { data: candleRows, error: cErr } = await db
    .from("candles")
    .select("symbol, ts, close, timeframe")
    .in("symbol", symbols)
    .in("timeframe", ["15m", "1d"])
    .gte("ts", new Date(Date.now() - 7 * 86400 * 1000).toISOString())
    .order("ts", { ascending: false })
    .limit(2000);
  if (cErr) throw new Error(`Load closes failed: ${cErr.message}`);
  const latest = new Map<string, { close: number; ts: string }>();
  for (const row of candleRows ?? []) {
    if (!latest.has(row.symbol as string)) {
      latest.set(row.symbol as string, { close: Number(row.close), ts: row.ts as string });
    }
  }

  const ids = open.map((p) => p.id as string);
  const { data: existing } = await db
    .from("discipline_events")
    .select("position_id")
    .eq("event_type", "line_crossed")
    .in("position_id", ids);
  const already = new Set((existing ?? []).map((e) => e.position_id as string));

  const breached: string[] = [];
  for (const p of open) {
    if (already.has(p.id as string)) continue;
    const px = latest.get(p.symbol as string);
    if (!px) continue;
    const line = Number(p.invalidation_at_entry);
    const isShort = (p.side as string) === "short";
    const crossed = isShort ? px.close > line : px.close < line;
    if (!crossed) continue;
    const detectedAt = new Date().toISOString();
    const ev = await db.from("discipline_events").insert({
      user_id: uid,
      position_id: p.id,
      event_type: "line_crossed",
      detected_at: detectedAt,
      price_at_detection: px.close,
      note: `close ₹${px.close} vs line ₹${line} (candle ${px.ts})`,
    });
    if (ev.error) {
      console.error(`discipline_events insert failed: ${ev.error.message}`);
      continue;
    }
    const beyondPct = Math.abs(((px.close - line) / line) * 100).toFixed(1);
    await insertAlert(uid, {
      symbol: p.symbol as string,
      alert_type: "line_crossed",
      severity: "critical",
      title: `Invalidation line crossed: ${p.symbol}`,
      body: `Closed at ₹${px.close} — ${beyondPct}% beyond your line of ₹${line}. Your plan says exit.`,
      payload: { position_id: p.id, price_at_detection: px.close, detected_at: detectedAt },
    });
    breached.push(p.symbol as string);
  }
  return { checked: open.length, breached };
}

// ── actions ──────────────────────────────────────────────────

async function actionSetKiteToken(uid: string | null, body: Record<string, unknown>) {
  const apiKey = typeof body.api_key === "string" ? body.api_key.trim() : "";
  const accessToken = typeof body.access_token === "string" ? body.access_token.trim() : "";
  if (!accessToken) throw new Error("access_token is required");
  const existing = (await getSecret("kite_credentials")) ?? {};
  const finalKey = apiKey || existing.api_key;
  if (!finalKey) throw new Error("api_key is required the first time");
  const now = new Date().toISOString();
  await setSecret("kite_credentials", {
    api_key: finalKey,
    access_token: accessToken,
    updated_at: now,
  });
  const masked = finalKey.length > 4 ? `••••${finalKey.slice(-4)}` : "••••";
  const status = { api_key_masked: masked, token_updated_at: now };
  const { error } = await db
    .from("settings")
    .upsert({ user_id: uid, key: "kite_status", value: status }, { onConflict: "user_id,key" });
  if (error) throw new Error(`Status write failed: ${error.message}`);
  return { ok: true, ...status };
}

async function actionSyncInstruments() {
  const creds = await kiteCreds();
  const res = await fetch("https://api.kite.trade/instruments/NSE", {
    headers: kiteHeaders(creds),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kite instruments fetch failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const csv = await res.text();
  const lines = csv.split("\n").filter(Boolean);
  const header = lines[0].split(",");
  const idx = (name: string) => header.indexOf(name);
  const iToken = idx("instrument_token");
  const iExch = idx("exchange_token");
  const iSym = idx("tradingsymbol");
  const iName = idx("name");
  const iSeg = idx("segment");
  const iType = idx("instrument_type");
  const iLot = idx("lot_size");
  const iTick = idx("tick_size");
  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols[iType] !== "EQ") continue;
    rows.push({
      instrument_token: Number(cols[iToken]),
      exchange_token: Number(cols[iExch]),
      tradingsymbol: cols[iSym],
      name: cols[iName],
      exchange: "NSE",
      segment: cols[iSeg],
      instrument_type: cols[iType],
      lot_size: Number(cols[iLot]) || null,
      tick_size: Number(cols[iTick]) || null,
      synced_at: new Date().toISOString(),
    });
  }
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await db
      .from("instruments")
      .upsert(chunk, { onConflict: "instrument_token" });
    if (error) throw new Error(`Instruments upsert failed: ${error.message}`);
    inserted += chunk.length;
  }
  return { count: inserted };
}

async function actionIngestCandles(uid: string | null, body: Record<string, unknown>) {
  const symbol = String(body.symbol ?? "");
  const timeframe = String(body.timeframe ?? "") as Timeframe;
  if (!symbol || !KITE_INTERVAL[timeframe]) throw new Error("symbol and valid timeframe required");
  const defaults: Record<Timeframe, number> = { "15m": 60, "1h": 100, "1d": 365, "1wk": 365 };
  const days =
    typeof body.days === "number" ? Math.min(Math.max(1, body.days), 400) : defaults[timeframe];
  const creds = await kiteCreds();
  const rows = await fetchKiteCandles(symbol, timeframe, days, creds, uid);
  if (rows.length === 0) return { symbol, timeframe, inserted: 0 };
  const inserted = await upsertCandles(rows);
  return { symbol, timeframe, inserted, latest_ts: rows[rows.length - 1].ts };
}

async function actionIngestCsv(uid: string | null, body: Record<string, unknown>) {
  const symbol = String(body.symbol ?? "");
  const timeframe = String(body.timeframe ?? "") as Timeframe;
  const csv = String(body.csv ?? "");
  if (!symbol || !KITE_INTERVAL[timeframe] || !csv)
    throw new Error("symbol, timeframe, csv required");
  if (csv.length > 5_000_000) throw new Error("CSV too large (5 MB max)");
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error("CSV has no data rows");
  const header = lines[0].split(",").map((s) => s.trim().toLowerCase());
  const iTs = header.findIndex((h) => /^(ts|time|timestamp|date)$/.test(h));
  const iO = header.indexOf("open");
  const iH = header.indexOf("high");
  const iL = header.indexOf("low");
  const iC = header.indexOf("close");
  const iV = header.findIndex((h) => /volume|vol/.test(h));
  if (iTs < 0 || iO < 0 || iH < 0 || iL < 0 || iC < 0) {
    throw new Error("CSV must include columns: timestamp,open,high,low,close[,volume]");
  }
  const rows: CandleRow[] = lines.slice(1).map((line) => {
    const cols = line.split(",");
    return {
      user_id: uid,
      symbol,
      timeframe,
      ts: new Date(cols[iTs]).toISOString(),
      open: Number(cols[iO]),
      high: Number(cols[iH]),
      low: Number(cols[iL]),
      close: Number(cols[iC]),
      volume: iV >= 0 ? Number(cols[iV]) : null,
    };
  });
  const inserted = await upsertCandles(rows);
  return { symbol, timeframe, inserted };
}

async function actionGetLtp(body: Record<string, unknown>) {
  const symbols = Array.isArray(body.symbols) ? body.symbols.map(String).slice(0, 200) : [];
  if (symbols.length === 0) throw new Error("symbols required");
  const creds = await kiteCreds();
  const params = symbols.map((s) => `i=NSE:${encodeURIComponent(s)}`).join("&");
  const res = await fetch(`https://api.kite.trade/quote/ltp?${params}`, {
    headers: kiteHeaders(creds),
  });
  if (!res.ok) throw new Error(`Kite LTP failed (${res.status})`);
  const body2 = (await res.json()) as {
    data: Record<string, { last_price: number }>;
  };
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(body2.data ?? {})) {
    out[k.split(":")[1] ?? k] = v.last_price;
  }
  return out;
}

async function actionRunScreener(uid: string | null, body: Record<string, unknown>) {
  const stocks = await loadActiveStocks();
  if (stocks.length === 0) throw new Error("No active symbols. Add stocks first.");
  const levels = body.recomputeLevels === false ? null : await computeAndStoreLevels(uid, stocks);
  const screener = await runAndStoreScreener(uid, stocks);
  return {
    levels,
    runDate: screener.runDate,
    qualifying: screener.result.qualifying.length,
    scanned: screener.result.scanned,
    rejectedThinSupport: screener.result.rejectedThinSupport,
    rejectedGeometry: screener.result.rejectedGeometry,
    rejectedRiskBand: screener.result.rejectedRiskBand,
    missingData: screener.missingData,
  };
}

async function actionRefreshCandles(uid: string | null, body: Record<string, unknown>) {
  if (!body.force && !istMarketOpenNow()) {
    return { ok: true, skipped: "outside NSE market hours" };
  }
  const stocks = await loadActiveStocks();
  if (stocks.length === 0) return { ok: true, skipped: "no active symbols" };
  const refresh = await refreshCandles(uid, stocks, [
    { timeframe: "15m", days: 3 },
    { timeframe: "1d", days: 6 },
  ]);
  if (refresh.allZero) {
    await insertAlert(uid, {
      alert_type: "provider_failure",
      severity: "critical",
      title: "Candle refresh returned no data",
      body: `Provider returned zero rows for all ${stocks.length} symbols. Existing data left untouched. Check the Kite access token in Settings.`,
      payload: { errors: refresh.errors.slice(0, 10) },
    });
    return { ok: false, error: "provider returned zero rows", refresh };
  }
  const lines = await checkLineCrossed(uid);
  const ruleAlerts = await evaluateAlertRules(uid);
  return {
    ok: true,
    refresh: { totalRows: refresh.totalRows, errors: refresh.errors },
    lines,
    ruleAlerts,
  };
}

async function actionNightly(uid: string | null) {
  const stocks = await loadActiveStocks();
  if (stocks.length === 0) return { ok: true, skipped: "no active symbols" };
  const refresh = await refreshCandles(uid, stocks, [{ timeframe: "1d", days: 10 }]);
  if (refresh.allZero) {
    await insertAlert(uid, {
      alert_type: "provider_failure",
      severity: "critical",
      title: "Nightly refresh returned no data",
      body: `Provider returned zero rows for all ${stocks.length} symbols. Levels and screener were NOT recomputed; yesterday's data stands. Check the Kite access token.`,
      payload: { errors: refresh.errors.slice(0, 10) },
    });
    return { ok: false, error: "provider returned zero rows", refresh };
  }
  const levels = await computeAndStoreLevels(uid, stocks);
  const screener = await runAndStoreScreener(uid, stocks);
  const lines = await checkLineCrossed(uid);
  const ruleAlerts = await evaluateAlertRules(uid);
  const q = screener.result.qualifying.length;
  const rej =
    screener.result.rejectedThinSupport +
    screener.result.rejectedGeometry +
    screener.result.rejectedRiskBand;
  await insertAlert(uid, {
    alert_type: "screener_run",
    severity: "info",
    title:
      q === 0
        ? "Screener: no qualifying setups today"
        : `Screener: ${q} qualifying setup${q === 1 ? "" : "s"}`,
    body:
      q === 0
        ? `Scanned ${screener.result.scanned} symbols, ${rej} rejected. A quiet day is a normal result, not a failure.`
        : `Scanned ${screener.result.scanned} symbols: ${q} qualified, ${rej} rejected. Review on the Screener screen.`,
    payload: { run_date: screener.runDate },
  });
  return {
    ok: true,
    refresh: { totalRows: refresh.totalRows, errors: refresh.errors },
    levels,
    screener: { runDate: screener.runDate, qualifying: q, scanned: screener.result.scanned },
    lines,
    ruleAlerts,
  };
}

// ── push subscription actions ────────────────────────────────

async function actionGetVapidPublic() {
  const cfg = await vapidConfig();
  if (!cfg) throw new Error("Web Push is not configured on the server yet.");
  return { publicKey: cfg.publicKey };
}

async function actionPushSubscribe(uid: string | null, body: Record<string, unknown>) {
  const endpoint = String(body.endpoint ?? "");
  const keys = body.keys as { p256dh?: string; auth?: string } | undefined;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    throw new Error("endpoint and keys {p256dh, auth} are required");
  }
  const { error } = await db
    .from("push_subscriptions")
    .upsert(
      { user_id: uid, endpoint, p256dh: keys.p256dh, auth: keys.auth },
      { onConflict: "endpoint" },
    );
  if (error) throw new Error(`Subscription save failed: ${error.message}`);
  return { ok: true };
}

async function actionPushUnsubscribe(body: Record<string, unknown>) {
  const endpoint = String(body.endpoint ?? "");
  if (!endpoint) throw new Error("endpoint required");
  await db.from("push_subscriptions").delete().eq("endpoint", endpoint);
  return { ok: true };
}

async function actionPushTest() {
  const sent = await sendPushToAll({
    title: "Swing Trade — test notification",
    body: "Push is working. Alerts will arrive even with the app closed.",
    severity: "info",
  });
  return { ok: true, sent };
}

// ── handler ──────────────────────────────────────────────────

// Actions the shared-secret (cron/ops) caller may run. Data-pipeline only —
// credential changes and push management always require the owner's JWT.
const CRON_ACTIONS = new Set([
  "refresh_candles",
  "nightly",
  "sync_instruments",
  "ingest_candles",
  "run_screener",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "body must be JSON" }, 400);
  }
  const action = String(body.action ?? "");

  let role: CallerRole | null;
  try {
    role = await callerRole(req);
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
  if (!role) return json({ error: "unauthorized" }, 401);
  if (role === "cron" && !CRON_ACTIONS.has(action)) {
    return json({ error: "this action requires a signed-in user" }, 403);
  }

  const uid = await ownerUid();
  try {
    switch (action) {
      case "set_kite_token":
        return json(await actionSetKiteToken(uid, body));
      case "sync_instruments":
        return json(await actionSyncInstruments());
      case "ingest_candles":
        return json(await actionIngestCandles(uid, body));
      case "ingest_csv":
        return json(await actionIngestCsv(uid, body));
      case "get_ltp":
        return json(await actionGetLtp(body));
      case "run_screener":
        return json(await actionRunScreener(uid, body));
      case "refresh_candles":
        return json(await actionRefreshCandles(uid, body));
      case "nightly":
        return json(await actionNightly(uid));
      case "get_vapid_public":
        return json(await actionGetVapidPublic());
      case "push_subscribe":
        return json(await actionPushSubscribe(uid, body));
      case "push_unsubscribe":
        return json(await actionPushUnsubscribe(body));
      case "push_test":
        return json(await actionPushTest());
      default:
        return json({ error: `unknown action "${action}"` }, 400);
    }
  } catch (e) {
    const message = String(e instanceof Error ? e.message : e);
    if (CRON_ACTIONS.has(action)) {
      await insertAlert(uid, {
        alert_type: "ingest_failure",
        severity: "warning",
        title: `Scheduled job failed: ${action}`,
        body: message,
      });
    }
    return json({ ok: false, error: message }, 500);
  }
});
