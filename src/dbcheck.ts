// 本番 DB のテーブル・列・初期データがコードの前提とそろっているかを確かめる

/** 後から追加したマイグレーションで増えた列。新しいマイグレーションで列を足したらここにも足す */
export const REQUIRED_COLUMNS: { table: string; column: string; migration: string }[] = [
  { table: "report_persons", column: "plea", migration: "0003_report_person_plea.sql" },
  { table: "reports", column: "police_agency", migration: "0005_more_details.sql" },
  { table: "judgments", column: "prefecture", migration: "0005_more_details.sql" },
  { table: "flag_reviews", column: "reviewed_flags", migration: "0007_flag_reviews.sql" },
  { table: "report_persons", column: "nationality", migration: "0008_nationality.sql" },
  { table: "cases", column: "progress", migration: "0009_case_progress.sql" },
  { table: "case_themes", column: "theme", migration: "0010_themes.sql" },
  { table: "report_persons", column: "public_figure", migration: "0010_themes.sql" },
];

export type DbStatus =
  | { ready: true; laws: number; aliases: number }
  | { ready: false; database: "not_migrated" | "migration_pending" | "not_seeded"; missing?: string[]; laws?: number; aliases?: number };

export async function checkDatabase(db: D1Database): Promise<DbStatus> {
  let counts: { laws: number; aliases: number } | null;
  try {
    counts = await db
      .prepare("SELECT (SELECT COUNT(*) FROM laws) AS laws, (SELECT COUNT(*) FROM charge_aliases) AS aliases")
      .first<{ laws: number; aliases: number }>();
  } catch {
    return { ready: false, database: "not_migrated" };
  }
  const missing: string[] = [];
  for (const r of REQUIRED_COLUMNS) {
    const hit = await db
      .prepare("SELECT 1 AS x FROM pragma_table_info(?) WHERE name = ?")
      .bind(r.table, r.column)
      .first();
    if (!hit) missing.push(`${r.table}.${r.column}（${r.migration}）`);
  }
  if (missing.length) return { ready: false, database: "migration_pending", missing };
  const laws = counts?.laws ?? 0;
  const aliases = counts?.aliases ?? 0;
  if (laws === 0 || aliases === 0) return { ready: false, database: "not_seeded", laws, aliases };
  return { ready: true, laws, aliases };
}
