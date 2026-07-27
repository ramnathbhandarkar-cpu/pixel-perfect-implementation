// NSE session clock. Everything in this app is quoted in IST regardless of
// where the browser thinks it is, because the market only has one clock.

const OPEN_MINUTES = 9 * 60 + 15; // 09:15 IST
const CLOSE_MINUTES = 15 * 60 + 30; // 15:30 IST

export interface MarketStatus {
  /** Plain-language state: "Market open", "Market closed", "Weekend". */
  label: string;
  /** Current wall-clock time in IST, e.g. "14:07". */
  istTime: string;
  isOpen: boolean;
  /** 0 = Sunday … 6 = Saturday, in IST. */
  istWeekday: number;
  /** Minutes since IST midnight. */
  istMinutes: number;
}

// Intl gives us IST parts without pulling in a date library, and without the
// classic "add 5.5 hours to a UTC date" trick that silently breaks whenever
// the host timezone is itself IST.
function istParts(at: Date): { weekday: number; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  // "24" shows up at midnight in some ICU builds; fold it back to 0.
  const hour = Number(get("hour")) % 24;
  return {
    weekday: Math.max(0, days.indexOf(get("weekday"))),
    hour,
    minute: Number(get("minute")),
  };
}

export function marketStatus(at: Date = new Date()): MarketStatus {
  const { weekday, hour, minute } = istParts(at);
  const mins = hour * 60 + minute;
  const weekend = weekday === 0 || weekday === 6;
  const isOpen = !weekend && mins >= OPEN_MINUTES && mins < CLOSE_MINUTES;

  // Trading holidays are not modelled — the app never blocks on this label,
  // and claiming "open" on a holiday is a cosmetic miss, not a wrong number.
  let label: string;
  if (weekend) label = "Weekend";
  else if (isOpen) label = "Market open";
  else if (mins < OPEN_MINUTES) label = "Opens 9:15";
  else label = "Market closed";

  return {
    label,
    istTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    isOpen,
    istWeekday: weekday,
    istMinutes: mins,
  };
}
