// 自動チェックのルールを直したあとに、保存済みの報道・判決の flags を付け直す
import { refreshCase, SEX_CRIME_LAWS } from "./ingest";
import { nowIso } from "./normalize";
import { detectPii } from "./pii";

interface Row {
  id: string;
  case_id: string;
  title: string;
  summary: string;
  flags: string | null;
  is_juvenile: number;
  laws: string | null; // カンマ区切りの法律コード
}

export async function rescanFlags(db: D1Database): Promise<{ checked: number; changed: number; flagged: number }> {
  let checked = 0;
  let changed = 0;
  let flagged = 0;
  const touchedCases = new Set<string>();
  const targets = [
    { table: "reports", charges: "report_charges", fk: "report_id" },
    { table: "judgments", charges: "judgment_charges", fk: "judgment_id" },
  ] as const;
  for (const t of targets) {
    const { results } = await db
      .prepare(
        `SELECT x.id, x.case_id, x.title, x.summary, x.flags, c.is_juvenile,
                (SELECT group_concat(law_code) FROM ${t.charges} ch WHERE ch.${t.fk} = x.id) AS laws
         FROM ${t.table} x JOIN cases c ON c.id = x.case_id`,
      )
      .all<Row>();
    const stmts: D1PreparedStatement[] = [];
    for (const r of results) {
      checked++;
      const isSexCrime = (r.laws ?? "").split(",").some((l) => SEX_CRIME_LAWS.has(l));
      const found = detectPii({ title: r.title, summary: r.summary }, { isJuvenile: r.is_juvenile === 1, isSexCrime });
      const next = found.length ? JSON.stringify(found) : null;
      if (found.length) flagged++;
      if (next !== r.flags) {
        changed++;
        touchedCases.add(r.case_id);
        stmts.push(db.prepare(`UPDATE ${t.table} SET flags = ? WHERE id = ?`).bind(next, r.id));
      }
    }
    for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));
  }
  const now = nowIso();
  for (const caseId of touchedCases) await refreshCase(db, caseId, now);
  return { checked, changed, flagged };
}
