// 国籍別の集計（管理画面用）。数える単位は「人」（同じ事件の同じ人物は 1 人）。
import { residenceGroup } from "./nationality";

export interface NatStatsQuery {
  from?: string;
  to?: string;
  law?: string;
  prefecture?: string; // 発生地
}

const CASE_LAWS = `SELECT r.case_id, rc.law_code FROM report_charges rc JOIN reports r ON r.id = rc.report_id
                   UNION SELECT j.case_id, jc.law_code FROM judgment_charges jc JOIN judgments j ON j.id = jc.judgment_id`;

export async function nationalityStats(db: D1Database, q: NatStatsQuery) {
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
  if (q.prefecture) {
    where.push("c.prefecture = ?");
    binds.push(q.prefecture);
  }
  // 人物ごとに 1 行。報道の被疑者と判決の被告人を person_ref でまとめ、記載のある国籍・在留資格を採る
  const baseCte = `base AS (SELECT c.id, c.prefecture FROM cases c WHERE ${where.join(" AND ")})`;
  const people = `
    ${baseCte},
    raw AS (
      SELECT r.case_id, COALESCE(p.person_ref, r.id || ':' || p.seq) AS pk, p.nationality, p.nationality_code, p.residence_status
        FROM report_persons p JOIN reports r ON r.id = p.report_id
      UNION ALL
      SELECT j.case_id, COALESCE(j.person_ref, j.id), j.defendant_nationality, j.defendant_nationality_code, j.defendant_residence_status
        FROM judgments j WHERE j.status = 'published'
    ),
    people AS (
      SELECT raw.case_id, raw.pk, MAX(raw.nationality) AS nationality, MAX(raw.nationality_code) AS code,
             MAX(raw.residence_status) AS residence, b.prefecture
        FROM raw JOIN base b ON b.id = raw.case_id GROUP BY raw.case_id, raw.pk
    )`;
  const [byNat, byRes, byGroup, byPref, judg] = await db.batch([
    db
      .prepare(`WITH ${people} SELECT nationality, MAX(code) AS code, COUNT(*) AS people, COUNT(DISTINCT case_id) AS cases FROM people GROUP BY nationality`)
      .bind(...binds),
    db.prepare(`WITH ${people} SELECT nationality, residence, COUNT(*) AS people FROM people GROUP BY 1, 2`).bind(...binds),
    db
      .prepare(
        `WITH ${people}, case_laws AS (${CASE_LAWS})
         SELECT p.nationality, COALESCE(l.group_name, '未分類') AS group_name, COUNT(DISTINCT p.case_id) AS cases
         FROM people p JOIN case_laws cl ON cl.case_id = p.case_id LEFT JOIN laws l ON l.code = cl.law_code GROUP BY 1, 2`,
      )
      .bind(...binds),
    db
      .prepare(`WITH ${people} SELECT nationality, COALESCE(prefecture, '不明') AS prefecture, COUNT(*) AS people FROM people GROUP BY 1, 2`)
      .bind(...binds),
    db
      .prepare(
        `WITH ${baseCte}
         SELECT j.defendant_nationality AS nationality, COUNT(*) AS judgments,
                SUM(j.sentence_type IN ('拘禁刑','懲役','禁錮') AND j.term_months IS NOT NULL) AS custodial,
                SUM(j.sentence_type IN ('拘禁刑','懲役','禁錮') AND j.suspended_months IS NOT NULL) AS suspended,
                AVG(j.ratio_to_demand) AS avg_ratio_to_demand, COUNT(j.ratio_to_demand) AS n_ratio_to_demand
         FROM judgments j JOIN base b ON b.id = j.case_id
         WHERE j.status = 'published' ${q.law ? "AND j.primary_law_code = ?" : ""}
         GROUP BY 1`,
      )
      .bind(...binds, ...(q.law ? [q.law] : [])),
  ]);

  type R = Record<string, unknown> & { nationality: string | null };
  const key = (n: string | null) => n ?? "記載なし";
  const round = (v: unknown) => (typeof v === "number" ? Math.round(v * 10000) / 10000 : null);
  const groupBy = <T extends R>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(key(r.nationality), [...(m.get(key(r.nationality)) ?? []), r]);
    return m;
  };
  const res = groupBy((byRes?.results ?? []) as (R & { residence: string | null; people: number })[]);
  const grp = groupBy((byGroup?.results ?? []) as (R & { group_name: string; cases: number })[]);
  const prf = groupBy((byPref?.results ?? []) as (R & { prefecture: string; people: number })[]);
  const jdg = new Map(((judg?.results ?? []) as R[]).map((r) => [key(r.nationality), r]));

  const rows = ((byNat?.results ?? []) as (R & { code: string | null; people: number; cases: number })[])
    .map((r) => {
      const k = key(r.nationality);
      const statuses = res.get(k) ?? [];
      const sumGroup = (g: string | null) =>
        statuses.filter((s) => residenceGroup(s.residence) === g).reduce((n, s) => n + s.people, 0);
      const j = jdg.get(k);
      const custodial = typeof j?.custodial === "number" ? j.custodial : 0;
      return {
        nationality: k,
        code: r.code,
        stated: r.nationality !== null,
        people: r.people,
        cases: r.cases,
        residence: {
          来日外国人: sumGroup("来日外国人"),
          定着居住者: sumGroup("定着居住者"),
          不明: sumGroup(null),
          内訳: statuses.filter((s) => s.residence).map((s) => ({ status: s.residence, people: s.people })).sort((a, b) => b.people - a.people),
        },
        by_group: (grp.get(k) ?? []).map((g) => ({ group_name: g.group_name, cases: g.cases })).sort((a, b) => b.cases - a.cases),
        top_prefectures: (prf.get(k) ?? []).map((p) => ({ prefecture: p.prefecture, people: p.people })).sort((a, b) => b.people - a.people).slice(0, 5),
        judgments: typeof j?.judgments === "number" ? j.judgments : 0,
        suspended_rate: custodial ? round((j?.suspended as number) / custodial) : null,
        custodial_judgments: custodial,
        avg_ratio_to_demand: round(j?.avg_ratio_to_demand),
        n_ratio_to_demand: typeof j?.n_ratio_to_demand === "number" ? j.n_ratio_to_demand : 0,
      };
    })
    .sort((a, b) => (a.stated === b.stated ? b.people - a.people : a.stated ? -1 : 1));

  const total = rows.reduce((n, r) => n + r.people, 0);
  const stated = rows.filter((r) => r.stated).reduce((n, r) => n + r.people, 0);
  const foreign = rows.filter((r) => r.stated && r.code !== "JP").reduce((n, r) => n + r.people, 0);

  // 在留資格別の全体内訳（記載ありのみ。不明・null は除外）
  const resTotals = new Map<string, number>();
  for (const r of (byRes?.results ?? []) as (R & { residence: string | null; people: number })[]) {
    if (!r.residence || r.residence === "不明") continue;
    resTotals.set(r.residence, (resTotals.get(r.residence) ?? 0) + r.people);
  }
  const residence_breakdown = [...resTotals.entries()]
    .map(([status, people]) => ({ status, group: residenceGroup(status), people }))
    .sort((a, b) => b.people - a.people || a.status.localeCompare(b.status, "ja"));

  return {
    from: q.from ?? null,
    to: q.to ?? null,
    law: q.law ?? null,
    prefecture: q.prefecture ?? null,
    total_people: total,
    stated_people: stated,
    foreign_people: foreign,
    nationalities: rows,
    residence_breakdown,
  };
}
