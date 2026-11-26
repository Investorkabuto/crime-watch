// 判決 1 件ごとの量刑指標（要件 §6.1）

export interface PenaltyPeriod {
  law_code: string;
  effective_from: string;
  effective_to: string | null;
  stat_min_months: number | null;
  stat_max_months: number | null;
  stat_has_death: number;
  stat_has_life: number;
}

const CUSTODIAL = new Set(["拘禁刑", "懲役", "禁錮"]);

/** 指定日に有効な法定刑 */
export function periodAt(periods: PenaltyPeriod[], lawCode: string, onDate: string): PenaltyPeriod | null {
  return (
    periods.find(
      (p) => p.law_code === lawCode && p.effective_from <= onDate && (p.effective_to === null || onDate < p.effective_to),
    ) ?? null
  );
}

/** 法定刑の重さの順位づけ（最も重い罪＝量刑指標の基準を選ぶため） */
export function severity(p: PenaltyPeriod | null): number {
  if (!p) return -1;
  return p.stat_has_death * 1_000_000 + p.stat_has_life * 100_000 + (p.stat_max_months ?? 0) * 100 + (p.stat_min_months ?? 0);
}

/** 指標 A: 法定刑の幅の中の位置（0〜1。加重があると 1 を超えることがある） */
export function positionInRange(sentenceType: string, termMonths: number | null, p: PenaltyPeriod | null): number | null {
  if (!p || termMonths == null || !CUSTODIAL.has(sentenceType)) return null;
  if (p.stat_min_months == null || p.stat_max_months == null || p.stat_max_months <= p.stat_min_months) return null;
  const v = (termMonths - p.stat_min_months) / (p.stat_max_months - p.stat_min_months);
  return Math.round(v * 10000) / 10000;
}

/** 指標 B: 求刑比 */
export function ratioToDemand(
  sentenceType: string,
  termMonths: number | null,
  demandType: string | null,
  demandMonths: number | null,
): number | null {
  if (termMonths == null || demandMonths == null || demandMonths === 0) return null;
  if (!CUSTODIAL.has(sentenceType) || !demandType || !CUSTODIAL.has(demandType)) return null;
  return Math.round((termMonths / demandMonths) * 10000) / 10000;
}
