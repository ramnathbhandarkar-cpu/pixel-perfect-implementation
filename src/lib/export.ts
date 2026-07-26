import { supabase } from "@/integrations/supabase/client";

// Phase 6 — full data export. The data belongs to the owner; getting it out
// must never require anything more than a click.

export const EXPORT_TABLES = [
  "watch_plans",
  "positions",
  "discipline_events",
  "screener_runs",
  "journal",
  "alerts",
  "alert_rules",
  "stocks",
  "levels",
] as const;

export type ExportTable = (typeof EXPORT_TABLES)[number];

async function fetchTable(table: ExportTable): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabase.from(table).select("*").limit(10000);
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data ?? []) as Record<string, unknown>[];
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown): string => {
    if (v == null) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
}

export function downloadFile(name: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function exportAllJson(): Promise<void> {
  const out: Record<string, unknown> = { exported_at: new Date().toISOString() };
  for (const t of EXPORT_TABLES) out[t] = await fetchTable(t);
  const stamp = new Date().toISOString().slice(0, 10);
  downloadFile(
    `swing-trade-export-${stamp}.json`,
    JSON.stringify(out, null, 2),
    "application/json",
  );
}

export async function exportTableCsv(table: ExportTable): Promise<void> {
  const rows = await fetchTable(table);
  const stamp = new Date().toISOString().slice(0, 10);
  downloadFile(`swing-trade-${table}-${stamp}.csv`, toCsv(rows), "text/csv");
}
