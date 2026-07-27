import { describe, expect, it } from "bun:test";
import { marketStatus } from "./market";

// All fixtures are written as UTC instants so the test is honest no matter
// what timezone the machine running it happens to be in. IST is UTC+5:30.
const utc = (iso: string) => new Date(iso);

describe("marketStatus", () => {
  it("is open at 09:15 IST on a weekday", () => {
    // 2026-07-27 is a Monday. 03:45Z = 09:15 IST.
    const s = marketStatus(utc("2026-07-27T03:45:00Z"));
    expect(s.isOpen).toBe(true);
    expect(s.istTime).toBe("09:15");
    expect(s.label).toBe("Market open");
  });

  it("is closed one minute before the open", () => {
    const s = marketStatus(utc("2026-07-27T03:44:00Z"));
    expect(s.isOpen).toBe(false);
    expect(s.label).toBe("Opens 9:15");
  });

  it("closes at 15:30 IST, exclusive", () => {
    expect(marketStatus(utc("2026-07-27T09:59:00Z")).isOpen).toBe(true); // 15:29
    const closed = marketStatus(utc("2026-07-27T10:00:00Z")); // 15:30
    expect(closed.isOpen).toBe(false);
    expect(closed.istTime).toBe("15:30");
    expect(closed.label).toBe("Market closed");
  });

  it("is never open on a Saturday or Sunday", () => {
    // 2026-08-01 is a Saturday, 2026-08-02 a Sunday — both mid-session in IST.
    const sat = marketStatus(utc("2026-08-01T06:00:00Z"));
    const sun = marketStatus(utc("2026-08-02T06:00:00Z"));
    expect(sat.isOpen).toBe(false);
    expect(sun.isOpen).toBe(false);
    expect(sat.label).toBe("Weekend");
    expect(sun.label).toBe("Weekend");
    expect(sat.istWeekday).toBe(6);
    expect(sun.istWeekday).toBe(0);
  });

  it("reports midnight IST as 00:xx, not 24:xx", () => {
    // 18:35Z Sunday = 00:05 IST Monday.
    const s = marketStatus(utc("2026-07-26T18:35:00Z"));
    expect(s.istTime).toBe("00:05");
    expect(s.istWeekday).toBe(1);
    expect(s.istMinutes).toBe(5);
  });

  it("converts the day correctly across the IST date boundary", () => {
    // 20:00Z Friday is already Saturday 01:30 IST.
    const s = marketStatus(utc("2026-07-31T20:00:00Z"));
    expect(s.istWeekday).toBe(6);
    expect(s.label).toBe("Weekend");
  });
});
