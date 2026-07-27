import { describe, expect, it } from "bun:test";
import {
  DEFAULT_TELEGRAM_PREFS,
  escapeHtml,
  normalisePrefs,
  shouldSend,
  telegramMessage,
  telegramSendUrl,
} from "./telegram";

describe("normalisePrefs", () => {
  it("defaults to disabled", () => {
    expect(normalisePrefs(undefined).enabled).toBe(false);
    expect(normalisePrefs(null).enabled).toBe(false);
    expect(normalisePrefs({}).enabled).toBe(false);
  });

  it("fills missing type toggles from the defaults", () => {
    const p = normalisePrefs({ enabled: true, types: { volume_hourly: true } });
    expect(p.types.volume_hourly).toBe(true);
    expect(p.types.line_crossed).toBe(true);
    expect(p.types.screener_run).toBe(false);
  });

  it("treats a truthy non-boolean as off", () => {
    expect(normalisePrefs({ enabled: "yes" }).enabled).toBe(false);
  });

  it("leaves volume alerts off by default — they are the noisy ones", () => {
    expect(DEFAULT_TELEGRAM_PREFS.types.volume_hourly).toBe(false);
  });
});

describe("shouldSend", () => {
  const on = normalisePrefs({ enabled: true });

  it("sends nothing at all while Telegram is off", () => {
    const off = normalisePrefs({ enabled: false, types: { line_crossed: true } });
    expect(shouldSend(off, "line_crossed", "critical")).toBe(false);
  });

  it("always sends a breached invalidation line once enabled", () => {
    const muted = normalisePrefs({ enabled: true, types: { line_crossed: false } });
    expect(shouldSend(muted, "line_crossed", "critical")).toBe(true);
  });

  it("always sends anything critical, whatever its type", () => {
    const muted = normalisePrefs({ enabled: true, types: { provider_failure: false } });
    expect(shouldSend(muted, "provider_failure", "critical")).toBe(true);
  });

  it("respects the toggle for ordinary alerts", () => {
    expect(shouldSend(on, "volume_hourly", "info")).toBe(false);
    expect(shouldSend(on, "level_cross", "warning")).toBe(true);
  });

  it("honours an explicit opt-in for a noisy type", () => {
    const p = normalisePrefs({ enabled: true, types: { volume_hourly: true } });
    expect(shouldSend(p, "volume_hourly", "info")).toBe(true);
  });
});

describe("escapeHtml", () => {
  it("escapes only what Telegram's HTML mode needs", () => {
    expect(escapeHtml("a & b <c> d")).toBe("a &amp; b &lt;c&gt; d");
  });

  it("leaves ₹ and ≠ alone", () => {
    expect(escapeHtml("₹1,204.50 ≠ signal")).toBe("₹1,204.50 ≠ signal");
  });
});

describe("telegramMessage", () => {
  it("passes the volume-spike warning through verbatim", () => {
    const msg = telegramMessage({
      symbol: "RELIANCE",
      severity: "info",
      title: "Hourly volume 4,00,000 crossed 3,00,000",
      body: "Volume spike ≠ direction. Wait for the close.",
    });
    expect(msg).toContain("Volume spike ≠ direction. Wait for the close.");
  });

  it("leads with the symbol and a severity marker", () => {
    const msg = telegramMessage({
      symbol: "ITC",
      severity: "critical",
      title: "Invalidation line crossed",
      body: "Closed at ₹400.",
    });
    expect(msg.startsWith("🔴 <b>ITC</b> — Invalidation line crossed")).toBe(true);
  });

  it("omits the symbol cleanly when there isn't one", () => {
    const msg = telegramMessage({
      severity: "warning",
      title: "Prices didn't update",
      body: "Nothing changed.",
    });
    expect(msg.startsWith("🟡 <b>Prices didn't update</b>")).toBe(true);
    expect(msg).not.toContain("—");
  });

  it("always carries the disclaimer", () => {
    const msg = telegramMessage({ severity: "info", title: "t", body: "b" });
    expect(msg).toContain("Descriptive measurements only. Not financial advice.");
  });

  it("escapes markup in a symbol or body rather than letting it render", () => {
    const msg = telegramMessage({
      symbol: "<b>X",
      severity: "info",
      title: "a & b",
      body: "<script>",
    });
    expect(msg).toContain("&lt;b&gt;X");
    expect(msg).toContain("a &amp; b");
    expect(msg).toContain("&lt;script&gt;");
  });
});

describe("telegramSendUrl", () => {
  it("builds the bot endpoint", () => {
    expect(telegramSendUrl("123:ABC")).toBe("https://api.telegram.org/bot123:ABC/sendMessage");
  });
});
