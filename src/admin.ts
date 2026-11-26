// 管理用の処理（非公開期間中は閲覧用トークンで保護）
import { classifyCharges } from "./classify";
import { loadDictionary, refreshCase } from "./ingest";
import { periodAt, positionInRange, ratioToDemand, severity, type PenaltyPeriod } from "./metrics";

/** 罪状辞書に従って保存済みの罪状を判定し直し、判決の量刑指標（最も重い罪・指標 A/B）も計算し直す */
export async function reclassifyAll(db: D1Database): Promise<{ changed: number; judgments_recomputed: number }> {
  const dict = await loadDictionary(db);
  let changed = 0;
  for (const table of ["report_charges", "judgment_charges"] as const) {
    const parent = table === "report_charges" ? "report_id" : "judgment_id";
    const { results } = await db
      .prepare(`SELECT ${parent} AS pid, seq, charge_text FROM ${table}`)
      .all<{ pid: string; seq: number; charge_text: string }>();
    const stmts: D1PreparedStatement[] = [];
    for (const r of results) {
      const [hit] = classifyCharges([r.charge_text], dict.aliases);
      stmts.push(
        db
          .prepare(`UPDATE ${table} SET law_code = ?, matched_alias = ? WHERE ${parent} = ? AND seq = ? AND law_code IS NOT ?`)
          .bind(hit?.lawCode ?? null, hit?.matchedAlias ?? null, r.pid, r.seq, hit?.lawCode ?? null),
      );
    }
    for (let i = 0; i < stmts.length; i += 100) {
      const res = await db.batch(stmts.slice(i, i + 100));
      changed += res.reduce((n, x) => n + (x.meta.changes ?? 0), 0);
    }
  }
  const judgments_recomputed = await recomputeJudgmentMetrics(db, dict.periods);
  return { changed, judgments_recomputed };
}

/** 判決ごとに、行為時点の法定刑で最も重い罪を選び直し、指標 A（法定刑内の位置）・B（求刑比）を計算し直す */
export async function recomputeJudgmentMetrics(db: D1Database, periods: PenaltyPeriod[]): Promise<number> {
  const { results: js } = await db
    .prepare(
      `SELECT j.id, COALESCE(j.occurred_on, c.occurred_on, j.decided_on) AS offense_date, j.sentence_type, j.term_months,
              j.demand_type, j.demand_months
       FROM judgments j JOIN cases c ON c.id = j.case_id`,
    )
    .all<{ id: string; offense_date: string; sentence_type: string; term_months: number | null; demand_type: string | null; demand_months: number | null }>();
  const { results: chs } = await db
    .prepare("SELECT judgment_id, seq, law_code FROM judgment_charges")
    .all<{ judgment_id: string; seq: number; law_code: string | null }>();
  const byJ = new Map<string, { seq: number; law_code: string | null }[]>();
  for (const c of chs) byJ.set(c.judgment_id, [...(byJ.get(c.judgment_id) ?? []), c]);
  const stmts: D1PreparedStatement[] = [];
  for (const j of js) {
    let best: { seq: number; law: string; period: PenaltyPeriod | null } | null = null;
    for (const c of byJ.get(j.id) ?? []) {
      if (!c.law_code) continue;
      const p = periodAt(periods, c.law_code, j.offense_date);
      if (!best || severity(p) > severity(best.period)) best = { seq: c.seq, law: c.law_code, period: p };
    }
    stmts.push(
      db
        .prepare("UPDATE judgments SET primary_law_code = ?, position_in_range = ?, ratio_to_demand = ? WHERE id = ?")
        .bind(
          best?.law ?? null,
          positionInRange(j.sentence_type, j.term_months, best?.period ?? null),
          ratioToDemand(j.sentence_type, j.term_months, j.demand_type, j.demand_months),
          j.id,
        ),
      db.prepare("UPDATE judgment_charges SET is_primary = CASE WHEN seq = ? THEN 1 ELSE 0 END WHERE judgment_id = ?").bind(best?.seq ?? -1, j.id),
    );
  }
  for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));
  return js.length;
}

/**
 * 自動チェックに引っかかった報道・判決の一覧。
 * 既定では未確認のものだけ。reviewed=true で確認済みのものだけを返す。
 */
export async function listFlagged(db: D1Database, opts: { reviewed?: boolean } = {}) {
  const { results } = await db
    .prepare(
      `SELECT * FROM (
         SELECT 'report' AS type, r.id, r.external_id, r.case_id, c.case_ref, c.status, r.title, r.summary, r.flags,
                r.reported_at AS at, fr.reviewed_at, fr.note,
                CASE WHEN fr.reviewed_flags = r.flags THEN 1 ELSE 0 END AS reviewed
           FROM reports r JOIN cases c ON c.id = r.case_id
           LEFT JOIN flag_reviews fr ON fr.parent_type = 'report' AND fr.parent_id = r.id
          WHERE r.flags IS NOT NULL
         UNION ALL
         SELECT 'judgment', j.id, j.external_id, j.case_id, c.case_ref, c.status, j.title, j.summary, j.flags,
                j.decided_on, fr.reviewed_at, fr.note,
                CASE WHEN fr.reviewed_flags = j.flags THEN 1 ELSE 0 END
           FROM judgments j JOIN cases c ON c.id = j.case_id
           LEFT JOIN flag_reviews fr ON fr.parent_type = 'judgment' AND fr.parent_id = j.id
          WHERE j.flags IS NOT NULL
       ) WHERE reviewed = ? ORDER BY at DESC LIMIT 500`,
    )
    .bind(opts.reviewed ? 1 : 0)
    .all<Record<string, unknown> & { flags: string }>();
  return results.map((r) => ({ ...r, flags: JSON.parse(r.flags) }));
}

/** 検出を「確認済み（問題なし）」にする、または取り消す。確認したときの検出内容を記録する */
export async function reviewFlag(
  db: D1Database,
  type: "report" | "judgment",
  id: string,
  opts: { undo?: boolean; note?: string },
): Promise<"ok" | "not_found" | "no_flags"> {
  const table = type === "report" ? "reports" : "judgments";
  const row = await db.prepare(`SELECT case_id, flags FROM ${table} WHERE id = ?`).bind(id).first<{ case_id: string; flags: string | null }>();
  if (!row) return "not_found";
  if (opts.undo) {
    await db.prepare("DELETE FROM flag_reviews WHERE parent_type = ? AND parent_id = ?").bind(type, id).run();
  } else {
    if (!row.flags) return "no_flags";
    await db
      .prepare(
        `INSERT INTO flag_reviews (parent_type, parent_id, reviewed_flags, decision, note, reviewed_at) VALUES (?, ?, ?, 'ok', ?, ?)
         ON CONFLICT(parent_type, parent_id) DO UPDATE SET reviewed_flags = excluded.reviewed_flags, decision = excluded.decision,
           note = excluded.note, reviewed_at = excluded.reviewed_at`,
      )
      .bind(type, id, row.flags, opts.note?.slice(0, 500) ?? null, new Date().toISOString())
      .run();
  }
  await refreshCase(db, row.case_id, new Date().toISOString());
  return "ok";
}

/** 事件の公開状態を変える（published / hidden）。判決の状態も合わせる */
export async function setCaseStatus(db: D1Database, idOrRef: string, status: "published" | "hidden"): Promise<boolean> {
  const row = await db.prepare("SELECT id FROM cases WHERE id = ? OR case_ref = ?").bind(idOrRef, idOrRef).first<{ id: string }>();
  if (!row) return false;
  await db.batch([
    db.prepare("UPDATE cases SET status = ?, updated_at = ? WHERE id = ?").bind(status, new Date().toISOString(), row.id),
    db.prepare("UPDATE judgments SET status = ? WHERE case_id = ?").bind(status, row.id),
  ]);
  return true;
}

/** 罪状辞書に言い方を追加する */
export async function addAlias(db: D1Database, alias: string, lawCode: string): Promise<"added" | "unknown_law" | "invalid"> {
  const a = alias.normalize("NFKC").replace(/\s/g, "").replace(/(違反|罪)$/, "");
  if (!a || a.length > 100) return "invalid";
  const law = await db.prepare("SELECT code FROM laws WHERE code = ?").bind(lawCode).first();
  if (!law) return "unknown_law";
  await db.prepare("INSERT INTO charge_aliases (alias, law_code) VALUES (?, ?) ON CONFLICT(alias) DO UPDATE SET law_code = excluded.law_code").bind(a, lawCode).run();
  return "added";
}
