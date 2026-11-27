// 都道府県別の集計（管理画面用）
import { PREFECTURES } from "./schema";

export type PrefBasis = "occurrence" | "police" | "court";

export interface PrefStatsQuery {
  basis?: PrefBasis;
  from?: string; // YYYY-MM-DD（発生日。分からなければ最新の報道・判決の日）
  to?: string; // YYYY-MM-DD（この日を含む）
  law?: string; // 法律コード
}

// どの都道府県に数えるか。SQL 片はここで決めた固定の文字列だけを使う（利用者の入力は埋め込まない）
export const PREF_EXPR: Record<PrefBasis, string> = {
  occurrence: "c.prefecture",
  police: `COALESCE(
      (SELECT r.police_prefecture FROM reports r WHERE r.case_id = c.id AND r.police_prefecture IS NOT NULL ORDER BY r.reported_at LIMIT 1),
      (SELECT j.police_prefecture FROM judgments j WHERE j.case_id = c.id AND j.police_prefecture IS NOT NULL ORDER BY j.decided_on LIMIT 1))`,
  court: `(SELECT co.prefecture FROM judgments j JOIN courts co ON co.id = j.court_id
           WHERE j.case_id = c.id AND co.prefecture IS NOT NULL ORDER BY j.decided_on LIMIT 1)`,
};

const CASE_LAWS = `SELECT r.case_id, rc.law_code FROM report_charges rc JOIN reports r ON r.id = rc.report_id
                   UNION SELECT j.case_id, jc.law_code FROM judgment_charges jc JOIN judgments j ON j.id = jc.judgment_id`;

export function resolvePrefBasis(raw?: string): PrefBasis {
  return raw === "police" || raw === "court" ? raw : "occurrence";
}

export async function prefectureStats(db: D1Database, q: PrefStatsQuery) {
  const basis: PrefBasis = resolvePrefBasis(q.basis);
  const where = ["c.status = 'published'"];
  const binds: unknown[] = [];
  const dateExpr = "COALESCE(c.occurred_on, substr(c.latest_at, 1, 10))";
  if (q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from)) {
    where.push(`${dateExpr} >= ?`);
    binds.push(q.from);
  }
  if (q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to)) {
    where.push(`${dateExpr} <= ?`);
    binds.push(q.to);
  }
  if (q.law) {
    where.push(`c.id IN (SELECT case_id FROM (${CASE_LAWS}) WHERE law_code = ?)`);
    binds.push(q.law);
  }
  const base = `base AS (SELECT c.id, ${PREF_EXPR[basis]} AS pref, c.is_juvenile FROM cases c WHERE ${where.join(" AND ")})`;
  // 判決の指標は、法律で絞ったときはその法律が最も重い罪の判決だけを使う
  const judgmentLaw = q.law ? "AND j.primary_law_code = ?" : "";

  const [cases, groups, judgments] = await db.batch([
    db.prepare(`WITH ${base} SELECT pref, COUNT(*) AS cases, SUM(is_juvenile) AS juvenile FROM base GROUP BY pref`).bind(...binds),
    db
      .prepare(
        `WITH ${base}, case_laws AS (${CASE_LAWS})
         SELECT b.pref, COALESCE(l.category, '未分類') AS category, COALESCE(l.group_name, '未分類') AS group_name,
                COUNT(DISTINCT b.id) AS cases
         FROM base b JOIN case_laws cl ON cl.case_id = b.id LEFT JOIN laws l ON l.code = cl.law_code
         GROUP BY 1, 2, 3`,
      )
      .bind(...binds),
    db
      .prepare(
        `WITH ${base}
         SELECT b.pref,
                COUNT(*) AS judgments,
                SUM(j.sentence_type IN ('拘禁刑','懲役','禁錮') AND j.term_months IS NOT NULL) AS custodial,
                SUM(j.sentence_type IN ('拘禁刑','懲役','禁錮') AND j.suspended_months IS NOT NULL) AS suspended,
                AVG(CASE WHEN j.sentence_type IN ('拘禁刑','懲役','禁錮') AND j.suspended_months IS NULL THEN j.term_months END) AS avg_term_months_actual,
                AVG(j.ratio_to_demand) AS avg_ratio_to_demand,
                COUNT(j.ratio_to_demand) AS n_ratio_to_demand,
                AVG(j.position_in_range) AS avg_position_in_range,
                COUNT(j.position_in_range) AS n_position_in_range,
                SUM(j.defendant_gender = 'male') AS male,
                SUM(j.defendant_gender = 'female') AS female
         FROM base b JOIN judgments j ON j.case_id = b.id
         WHERE j.status = 'published' ${judgmentLaw}
         GROUP BY b.pref`,
      )
      .bind(...binds, ...(q.law ? [q.law] : [])),
  ]);

  type Row = Record<string, unknown> & { pref: string | null };
  const byPref = <T extends Row>(rows: T[]) => new Map(rows.map((r) => [r.pref ?? "不明", r]));
  const c = byPref((cases?.results ?? []) as Row[]);
  const j = byPref((judgments?.results ?? []) as Row[]);
  const g = new Map<string, { category: string; group_name: string; cases: number }[]>();
  for (const r of (groups?.results ?? []) as (Row & { category: string; group_name: string; cases: number })[]) {
    const key = r.pref ?? "不明";
    g.set(key, [...(g.get(key) ?? []), { category: r.category, group_name: r.group_name, cases: r.cases }]);
  }

  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  const round = (v: unknown) => (typeof v === "number" ? Math.round(v * 10000) / 10000 : null);
  const rows = [...PREFECTURES, "不明"].map((pref) => {
    const cr = c.get(pref);
    const jr = j.get(pref);
    const custodial = num(jr?.custodial);
    return {
      prefecture: pref,
      cases: num(cr?.cases),
      juvenile_cases: num(cr?.juvenile),
      by_group: (g.get(pref) ?? []).sort((a, b) => b.cases - a.cases),
      judgments: num(jr?.judgments),
      custodial_judgments: custodial,
      suspended_rate: custodial ? round(num(jr?.suspended) / custodial) : null,
      avg_term_months_actual: round(jr?.avg_term_months_actual),
      avg_ratio_to_demand: round(jr?.avg_ratio_to_demand),
      n_ratio_to_demand: num(jr?.n_ratio_to_demand),
      avg_position_in_range: round(jr?.avg_position_in_range),
      n_position_in_range: num(jr?.n_position_in_range),
      male: num(jr?.male),
      female: num(jr?.female),
    };
  });
  const total = rows.reduce((n, r) => n + r.cases, 0);
  return { basis, from: q.from ?? null, to: q.to ?? null, law: q.law ?? null, total_cases: total, prefectures: rows };
}
