// Telegram delivery for alerts.
//
// Web Push works but is easy to miss and easy to turn off by accident on a
// phone. Telegram is the channel he actually reads, so the alerts that matter
// go there too. The bot token and chat id live in server_secrets — never in a
// client-readable table, never in this repo.
//
// Everything here is pure formatting so the wording can be tested; the
// sending lives in the edge function.

export type AlertType =
  | "line_crossed"
  | "provider_failure"
  | "volume_hourly"
  | "price_target"
  | "level_cross"
  | "screener_run"
  | "test";

export type Severity = "info" | "warning" | "critical";

export interface TelegramPrefs {
  enabled: boolean;
  types: Partial<Record<AlertType, boolean>>;
}

// What each type is, in words rather than a slug. The order is the order
// they appear in Settings.
export const ALERT_TYPES: { key: AlertType; label: string; blurb: string; locked?: boolean }[] = [
  {
    key: "line_crossed",
    label: "Price passed your exit",
    blurb: "The one that matters. Always on.",
    locked: true,
  },
  {
    key: "provider_failure",
    label: "Prices stopped updating",
    blurb: "So you know the numbers you're looking at are stale.",
  },
  {
    key: "level_cross",
    label: "A level was crossed",
    blurb: "Price moved through a support or resistance you're watching.",
  },
  {
    key: "price_target",
    label: "A price marker was reached",
    blurb: "For markers you set yourself.",
  },
  {
    key: "volume_hourly",
    label: "Unusual volume",
    blurb: "Noisy by nature — off by default.",
  },
  {
    key: "screener_run",
    label: "Overnight measurements finished",
    blurb: "A nightly summary, even when nothing qualifies.",
  },
];

export const DEFAULT_TELEGRAM_PREFS: TelegramPrefs = {
  enabled: false,
  types: {
    line_crossed: true,
    provider_failure: true,
    level_cross: true,
    price_target: true,
    volume_hourly: false,
    screener_run: false,
  },
};

export function normalisePrefs(raw: unknown): TelegramPrefs {
  const v = (raw ?? {}) as Partial<TelegramPrefs>;
  return {
    enabled: v.enabled === true,
    types: { ...DEFAULT_TELEGRAM_PREFS.types, ...(v.types ?? {}) },
  };
}

/**
 * Should this alert go to Telegram?
 *
 * A breached invalidation line is never suppressible. That is the whole
 * point of the system — a toggle that can silence it would be a toggle for
 * switching off the discipline.
 */
export function shouldSend(prefs: TelegramPrefs, type: AlertType, severity: Severity): boolean {
  if (!prefs.enabled) return false;
  if (type === "line_crossed" || severity === "critical") return true;
  return prefs.types[type] === true;
}

/** Telegram's HTML parse mode only requires these three. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const PREFIX: Record<Severity, string> = {
  critical: "🔴",
  warning: "🟡",
  info: "⚪",
};

/**
 * Build the message text.
 *
 * The alert body is passed through verbatim. The wording of these alerts is
 * load-bearing — "Volume spike ≠ direction. Wait for the close." exists to
 * stop him reading a volume spike as a signal — so nothing here rewrites,
 * truncates or summarises it.
 */
export function telegramMessage(alert: {
  symbol?: string | null;
  severity: Severity;
  title: string;
  body: string;
}): string {
  const head = alert.symbol
    ? `${PREFIX[alert.severity]} <b>${escapeHtml(alert.symbol)}</b> — ${escapeHtml(alert.title)}`
    : `${PREFIX[alert.severity]} <b>${escapeHtml(alert.title)}</b>`;
  return `${head}\n${escapeHtml(alert.body)}\n\n<i>Descriptive measurements only. Not financial advice.</i>`;
}

export function telegramSendUrl(botToken: string): string {
  return `https://api.telegram.org/bot${botToken}/sendMessage`;
}
