// 公開サイト用の集計テーブルを再計算する（Cron で 1 時間ごとに実行）
import { nowIso } from "./normalize";

const CUSTODIAL_SQL = "sentence_type IN ('拘禁刑','懲役','禁錮')";

function quantile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return Math.round((sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo)) * 100) / 100;
}

export interface AggregateResult {
  theme_rows: number;
  law_rows: number;
  dist_rows: number;
  computed_at: string;
}

/**
 * agg_theme_monthly / agg_law_monthly / agg_sentence_dist を作り直す。
 * 非公開の事件（status != 'published'）は集計に含めない。
 */
export async function recomputeAggregates(db: D1Database): Promise<AggregateResult> {
  const computedAt = nowIso();

  // 1. 刑期分布は分位点が必要なため判決の刑期をアプリ側で計算して入れ直す
  const { results: jRows } = await db
    .prepare(
      `SELECT j.primary_law_code, j.instance, j.term_months, j.suspended_months, j.ratio_to_demand, j.juvenile_class
       FROM judgments j
       JOIN cases c ON c.id = j.case_id
       WHERE c.status = 'published'
         AND j.status = 'published'
         AND j.primary_law_code IS NOT NULL
         AND j.${CUSTODIAL_SQL}
         AND j.term_months IS NOT NULL
         AND (j.juvenile_class IS NULL OR j.juvenile_class = 'adult')`,
    )
    .all<{
      primary_law_code: string;
      instance: string | null;
      term_months: number;
      suspended_months: number | null;
      ratio_to_demand: number | null;
      juvenile_class: string | null;
    }>();

  type Bucket = { terms: number[]; suspended: number; ratios: number[] };
  const buckets = new Map<string, Bucket>();
  const add = (lawCode: string, inst: string, row: (typeof jRows)[number]) => {
    const k = `${lawCode}\0${inst}`;
    let b = buckets.get(k);
    if (!b) {
      b = { terms: [], suspended: 0, ratios: [] };
      buckets.set(k, b);
    }
    b.terms.push(row.term_months);
    if (row.suspended_months !== null) b.suspended++;
    if (row.ratio_to_demand !== null) b.ratios.push(row.ratio_to_demand);
  };

  for (const r of jRows) {
    add(r.primary_law_code, "*", r);
    if (r.instance) add(r.primary_law_code, r.instance, r);
  }

  const distInserts: D1PreparedStatement[] = [];
  for (const [k, b] of buckets) {
    const [lawCode, inst] = k.split("\0") as [string, string];
    b.terms.sort((a, c) => a - c);
    const n = b.terms.length;
    const avgRatio =
      b.ratios.length > 0
        ? Math.round((b.ratios.reduce((s, v) => s + v, 0) / b.ratios.length) * 10000) / 10000
        : null;
    distInserts.push(
      db
        .prepare(
          `INSERT INTO agg_sentence_dist
           (law_code, instance, n, min_months, p25_months, median_months, p75_months, max_months,
            suspended_n, custodial_n, avg_ratio_to_demand, n_ratio_to_demand, computed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          lawCode,
          inst,
          n,
          b.terms[0] ?? null,
          quantile(b.terms, 0.25),
          quantile(b.terms, 0.5),
          quantile(b.terms, 0.75),
          b.terms[n - 1] ?? null,
          b.suspended,
          n,
          avgRatio,
          b.ratios.length,
          computedAt,
        ),
    );
  }

  // 2. テーマ別・法律別の月次集計と刑期分布をまとめて入れ直す
  const stmts: D1PreparedStatement[] = [
    db.prepare("DELETE FROM agg_theme_monthly"),
    db.prepare(
      `INSERT INTO agg_theme_monthly (theme, month, prefecture, cases)
       SELECT ct.theme,
              substr(COALESCE(c.occurred_on, c.latest_at), 1, 7) AS month,
              COALESCE(c.prefecture, '不明') AS prefecture,
              COUNT(DISTINCT c.id) AS cases
       FROM cases c
       JOIN case_themes ct ON ct.case_id = c.id
       WHERE c.status = 'published'
       GROUP BY 1, 2, 3`,
    ),
    db.prepare("DELETE FROM agg_law_monthly"),
    db.prepare(
      `INSERT INTO agg_law_monthly (law_code, month, prefecture, cases)
       WITH case_laws AS (
         SELECT r.case_id, rc.law_code FROM report_charges rc JOIN reports r ON r.id = rc.report_id WHERE rc.law_code IS NOT NULL
         UNION
         SELECT j.case_id, jc.law_code FROM judgment_charges jc JOIN judgments j ON j.id = jc.judgment_id WHERE jc.law_code IS NOT NULL AND j.status = 'published'
       )
       SELECT cl.law_code,
              substr(COALESCE(c.occurred_on, c.latest_at), 1, 7) AS month,
              COALESCE(c.prefecture, '不明') AS prefecture,
              COUNT(DISTINCT c.id) AS cases
       FROM cases c
       JOIN case_laws cl ON cl.case_id = c.id
       WHERE c.status = 'published'
       GROUP BY 1, 2, 3`,
    ),
    db.prepare("DELETE FROM agg_sentence_dist"),
    ...distInserts,
    db
      .prepare("INSERT OR REPLACE INTO agg_meta (key, value) VALUES ('last_aggregated_at', ?)")
      .bind(computedAt),
  ];

  await db.batch(stmts);

  const [tCnt, lCnt] = await db.batch([
    db.prepare("SELECT COUNT(*) AS n FROM agg_theme_monthly"),
    db.prepare("SELECT COUNT(*) AS n FROM agg_law_monthly"),
  ]);

  return {
    theme_rows: Number((tCnt?.results?.[0] as { n?: number } | undefined)?.n ?? 0),
    law_rows: Number((lCnt?.results?.[0] as { n?: number } | undefined)?.n ?? 0),
    dist_rows: distInserts.length,
    computed_at: computedAt,
  };
}
