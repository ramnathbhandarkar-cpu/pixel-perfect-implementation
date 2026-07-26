// MIRROR of src/lib/screener-engine.ts — keep the two in sync (unit tests run against src/lib).
// Phase 3 — screener. Pure and isomorphic: the Screener screen evaluates
// stored levels client-side with the exact same maths the nightly job runs
// server-side. Constants ported from the owner's unit-tested Python system.

export const MIN_RATIO = 2.0;
export const MIN_SUPPORT_TESTS = 2; // an untested low is not a floor
export const RISK_PCT_MIN = 1.5; // tighter → stopped by noise
export const RISK_PCT_MAX = 8; // wider → not a 1–2 week swing
export const DOWNTREND_PENALTY = 0.45;
export const TESTS_SCORE_FLOOR = 0.3;
export const TESTS_SCORE_WEIGHT = 0.7;
export const TESTS_SCORE_CAP = 4;

export type RejectionCategory = "thin_support" | "geometry" | "risk_band";

export interface ScreenerInput {
  symbol: string;
  sector: string | null;
  price: number;
  priceAsOf?: string | null; // ISO date of the close used — surfaced, never hidden
  support: number | null;
  supportTests: number;
  resistance: number | null;
  resistanceTests: number;
  trendContext: string | null;
  isDowntrend: boolean;
  levelAsOf?: string | null;
}

export interface ScreenerEvaluation extends ScreenerInput {
  risk: number | null;
  reward: number | null;
  ratio: number | null;
  riskPct: number | null;
  qualifies: boolean;
  score: number | null; // ranking score, qualifying rows only
  rejectionCategory: RejectionCategory | null;
  rejectionReasons: string[];
}

export interface ScreenerRunResult {
  qualifying: ScreenerEvaluation[]; // sorted by score, best first
  rejected: ScreenerEvaluation[];
  rejectedThinSupport: number;
  rejectedGeometry: number;
  rejectedRiskBand: number;
  scanned: number;
}

export function rankingScore(ratio: number, supportTests: number, isDowntrend: boolean): number {
  return (
    ratio *
    (isDowntrend ? DOWNTREND_PENALTY : 1.0) *
    (TESTS_SCORE_FLOOR +
      (TESTS_SCORE_WEIGHT * Math.min(supportTests, TESTS_SCORE_CAP)) / TESTS_SCORE_CAP)
  );
}

export function evaluateSetup(input: ScreenerInput): ScreenerEvaluation {
  const { price, support, resistance, supportTests } = input;
  const risk = support != null ? price - support : null;
  const reward = resistance != null ? resistance - price : null;
  const ratio = risk != null && risk > 0 && reward != null ? reward / risk : null;
  const riskPct = risk != null ? (risk / price) * 100 : null;

  const reasons: string[] = [];
  let category: RejectionCategory | null = null;

  // Thin support first — the more fundamental flaw. A stock with 1:2 geometry
  // but a once-touched floor is reported as thin support, per spec.
  if (support == null) {
    category = "thin_support";
    reasons.push("no tested level below price");
  } else if (supportTests < MIN_SUPPORT_TESTS) {
    category = "thin_support";
    reasons.push(`support tested ${supportTests}× — fewer than ${MIN_SUPPORT_TESTS} times`);
  }
  if (resistance == null) {
    category = category ?? "geometry";
    reasons.push("no tested level above price");
  } else if (ratio != null && ratio < MIN_RATIO) {
    category = category ?? "geometry";
    reasons.push(`reward:risk 1:${ratio.toFixed(1)} — below 1:${MIN_RATIO.toFixed(1)}`);
  }
  if (riskPct != null) {
    if (riskPct < RISK_PCT_MIN) {
      category = category ?? "risk_band";
      reasons.push(
        `stop ${riskPct.toFixed(1)}% away — closer than ${RISK_PCT_MIN}%, would be stopped by noise`,
      );
    } else if (riskPct > RISK_PCT_MAX) {
      category = category ?? "risk_band";
      reasons.push(
        `stop ${riskPct.toFixed(1)}% away — wider than ${RISK_PCT_MAX}%, not a 1–2 week swing`,
      );
    }
  }

  const qualifies = category == null && ratio != null && ratio >= MIN_RATIO;
  return {
    ...input,
    risk,
    reward,
    ratio,
    riskPct,
    qualifies,
    score: qualifies ? rankingScore(ratio!, supportTests, input.isDowntrend) : null,
    rejectionCategory: qualifies ? null : category,
    rejectionReasons: qualifies ? [] : reasons,
  };
}

export function runScreener(inputs: ScreenerInput[]): ScreenerRunResult {
  const evaluations = inputs.map(evaluateSetup);
  const qualifying = evaluations
    .filter((e) => e.qualifies)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const rejected = evaluations.filter((e) => !e.qualifies);
  return {
    qualifying,
    rejected,
    rejectedThinSupport: rejected.filter((e) => e.rejectionCategory === "thin_support").length,
    rejectedGeometry: rejected.filter((e) => e.rejectionCategory === "geometry").length,
    rejectedRiskBand: rejected.filter((e) => e.rejectionCategory === "risk_band").length,
    scanned: inputs.length,
  };
}

// Sector clustering — descriptive concentration note when ≥2 qualifying
// setups share a sector. Correlated setups tend to fail together.
export function sectorClusters(
  qualifying: ScreenerEvaluation[],
): { sector: string; symbols: string[] }[] {
  const bySector = new Map<string, string[]>();
  for (const q of qualifying) {
    if (!q.sector) continue;
    const list = bySector.get(q.sector) ?? [];
    list.push(q.symbol);
    bySector.set(q.sector, list);
  }
  return [...bySector.entries()]
    .filter(([, symbols]) => symbols.length >= 2)
    .map(([sector, symbols]) => ({ sector, symbols }))
    .sort((a, b) => b.symbols.length - a.symbols.length);
}
