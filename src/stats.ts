// 試行で測る項目（要件 §12.3）

export async function trialStats(db: D1Database) {
  const [totals, fill, charges, unclassified, byLaw, flags, daily] = await db.batch([
    db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM cases) AS cases,
         (SELECT COUNT(*) FROM reports) AS reports,
         (SELECT COUNT(*) FROM reports WHERE backfill = 1) AS reports_backfill,
         (SELECT COUNT(*) FROM judgments) AS judgments,
         (SELECT COUNT(*) FROM judgments WHERE backfill = 1) AS judgments_backfill,
         (SELECT COUNT(*) FROM judges) AS judges,
         (SELECT COUNT(*) FROM courts) AS courts`,
    ),
    db.prepare(
      `SELECT COUNT(*) AS n,
         AVG(demand_type IS NOT NULL) AS demand,
         AVG(EXISTS (SELECT 1 FROM judgment_judges jj WHERE jj.judgment_id = j.id)) AS any_judge,
         AVG(EXISTS (SELECT 1 FROM judgment_judges jj WHERE jj.judgment_id = j.id AND jj.role IN ('裁判長','単独'))) AS presiding_judge,
         AVG(defendant_gender IN ('male','female')) AS gender,
         AVG(gender_inherited = 1) AS gender_inherited,
         AVG(defendant_age IS NOT NULL OR defendant_age_group IS NOT NULL) AS age,
         AVG(instance IS NOT NULL) AS instance,
         AVG(lay_judge_trial IS NOT NULL) AS lay_judge_trial,
         AVG(plea IS NOT NULL AND plea <> 'unknown') AS plea,
         AVG(damage_yen IS NOT NULL) AS damage_yen,
         AVG(harm_result IS NOT NULL AND harm_result <> 'unknown') AS harm_result,
         AVG(position_in_range IS NOT NULL) AS position_in_range,
         AVG(ratio_to_demand IS NOT NULL) AS ratio_to_demand
       FROM judgments j`,
    ),
    db.prepare(
      `SELECT COUNT(*) AS total, SUM(law_code IS NULL) AS unclassified FROM
         (SELECT law_code FROM report_charges UNION ALL SELECT law_code FROM judgment_charges)`,
    ),
    db.prepare(
      `SELECT charge_text, COUNT(*) AS n FROM
         (SELECT charge_text FROM report_charges WHERE law_code IS NULL
          UNION ALL SELECT charge_text FROM judgment_charges WHERE law_code IS NULL)
       GROUP BY charge_text ORDER BY n DESC LIMIT 50`,
    ),
    db.prepare(
      `SELECT l.code, l.name,
         (SELECT COUNT(DISTINCT r.case_id) FROM report_charges rc JOIN reports r ON r.id = rc.report_id WHERE rc.law_code = l.code) AS report_cases,
         (SELECT COUNT(*) FROM judgments j WHERE j.primary_law_code = l.code) AS judgments
       FROM laws l ORDER BY l.sort_order`,
    ),
    db.prepare(
      `SELECT (SELECT SUM(CASE WHEN r.flags IS NOT NULL AND NOT EXISTS (SELECT 1 FROM flag_reviews fr WHERE fr.parent_type = 'report' AND fr.parent_id = r.id AND fr.reviewed_flags = r.flags) THEN 1 ELSE 0 END) FROM reports r) AS reports,
              (SELECT SUM(CASE WHEN j.flags IS NOT NULL AND NOT EXISTS (SELECT 1 FROM flag_reviews fr WHERE fr.parent_type = 'judgment' AND fr.parent_id = j.id AND fr.reviewed_flags = j.flags) THEN 1 ELSE 0 END) FROM judgments j) AS judgments,
              (SELECT COUNT(*) FROM flag_reviews) AS reviewed`,
    ),
    db.prepare(
      `SELECT substr(received_at, 1, 10) AS day, SUM(item_count) AS items, SUM(created) AS created,
              SUM(updated) AS updated, SUM(rejected) AS rejected, SUM(flagged) AS flagged
       FROM ingest_logs GROUP BY day ORDER BY day DESC LIMIT 60`,
    ),
  ]);
  const c = (charges?.results?.[0] ?? { total: 0, unclassified: 0 }) as { total: number; unclassified: number };
  return {
    totals: totals?.results?.[0] ?? {},
    judgment_fill_rates: fill?.results?.[0] ?? {},
    charges: { ...c, unclassified_rate: c.total ? c.unclassified / c.total : null },
    top_unclassified: unclassified?.results ?? [],
    by_law: ((byLaw?.results ?? []) as { report_cases: number; judgments: number }[]).filter(
      (r) => r.report_cases > 0 || r.judgments > 0,
    ),
    flagged: flags?.results?.[0] ?? {},
    daily_ingest: daily?.results ?? [],
  };
}
