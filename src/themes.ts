// テーマタグ（要件 §13.8）。SNS から事件を探してもらうための切り口で、法律の分類とは別に持つ。
// 自動のテーマはデータから事実として判定できるものだけ。Muse が付けるテーマは記事に書かれている場合だけ（基本方針 §0）。

export const THEMES = [
  // 詐欺・強盗
  "闇バイト・トクリュウ", "特殊詐欺", "SNS型投資詐欺", "ロマンス詐欺", "生活保護不正受給", "強盗",
  // 立場
  "公務員の犯罪", "教員の犯罪", "警察官の犯罪", "医療・福祉職の犯罪", "政治家・汚職", "企業犯罪", "著名人",
  // 被害者
  "子どもが被害者", "高齢者が被害者", "児童虐待", "DV・ストーカー", "性犯罪",
  // 交通
  "飲酒運転", "あおり運転", "高齢ドライバー",
  // ネット
  "ネット・SNSの犯罪", "誹謗中傷", "迷惑行為・迷惑系配信者", "サイバー犯罪",
  // その他
  "薬物", "外国人犯罪", "少年事件", "未解決事件",
  // 判決
  "死刑判決", "無期判決", "無罪判決", "求刑超え", "再審・冤罪",
] as const;
export type Theme = (typeof THEMES)[number];

/** 著名人の区分。見出し・要約では「某歌手」のように書き、本名・芸名は扱わない */
export const PUBLIC_FIGURES = [
  "歌手", "俳優", "タレント", "歌舞伎役者", "お笑い芸人", "スポーツ選手", "政治家", "経営者",
  "配信者・インフルエンサー", "作家・文化人", "その他",
] as const;

// ===== 自動のテーマ（SQL で事件ごとに判定する）=====
// 事件に属する罪状の法律・本文、人物、被害者、判決を、それぞれ 1 つの集まりにしてから判定する。
// CROSS JOIN は結合の順番を固定し、+law_code は法律の索引を使わせない（どちらも SQLite の仕様）。1 件ごとの計算で、事件の報道・判決から読み始めるようにするため
const CASE_LAWS = `
  SELECT r.case_id, +rc.law_code AS law_code, rc.raw_text FROM reports r CROSS JOIN report_charges rc ON rc.report_id = r.id WHERE 1=1{{R}}
  UNION ALL SELECT j.case_id, +jc.law_code AS law_code, jc.raw_text FROM judgments j CROSS JOIN judgment_charges jc ON jc.judgment_id = j.id WHERE 1=1{{J}}`;
const CASE_PEOPLE = `
  SELECT r.case_id, p.occupation, p.age, p.age_group, p.nationality, p.nationality_code, p.public_figure
    FROM reports r CROSS JOIN report_persons p ON p.report_id = r.id WHERE 1=1{{R}}
  UNION ALL SELECT j.case_id, j.defendant_occupation, j.defendant_age, j.defendant_age_group, j.defendant_nationality,
    j.defendant_nationality_code, j.defendant_public_figure FROM judgments j WHERE 1=1{{J}}`;
const CASE_VICTIMS = `
  SELECT r.case_id, v.age_group, v.relation FROM reports r CROSS JOIN victims v ON v.parent_type = 'report' AND v.parent_id = r.id WHERE 1=1{{R}}
  UNION ALL SELECT j.case_id, v.age_group, v.relation FROM judgments j CROSS JOIN victims v ON v.parent_type = 'judgment' AND v.parent_id = j.id WHERE 1=1{{J}}`;

/** [テーマ, その事件の case_id を返す SQL] */
const AUTO_RULES: [Theme, string][] = [
  // 生活保護法違反、または詐欺の事件で、見出し・要約に「生活保護」と書かれているもの
  ["生活保護不正受給", `SELECT case_id FROM (${CASE_LAWS}) WHERE law_code = 'public_assistance'
                         UNION SELECT cl.case_id FROM (${CASE_LAWS}) cl JOIN cases c ON c.id = cl.case_id
                          WHERE cl.law_code IN ('fraud','organized_fraud') AND (c.title LIKE '%生活保護%' OR c.summary LIKE '%生活保護%')`],
  ["強盗", `SELECT case_id FROM (${CASE_LAWS}) WHERE law_code IN ('robbery','robbery_injury','robbery_murder')`],
  ["特殊詐欺", `SELECT case_id FROM (${CASE_LAWS}) WHERE raw_text LIKE '%特殊詐欺%' OR raw_text LIKE '%オレオレ%' OR raw_text LIKE '%還付金詐欺%' OR raw_text LIKE '%架空請求%'`],
  ["政治家・汚職", `SELECT case_id FROM (${CASE_LAWS}) WHERE law_code IN ('bribery','election')
                     UNION SELECT case_id FROM (${CASE_PEOPLE}) WHERE occupation = '議員' OR public_figure = '政治家'`],
  ["公務員の犯罪", `SELECT case_id FROM (${CASE_PEOPLE}) WHERE occupation IN ('公務員','警察官','議員')`],
  ["教員の犯罪", `SELECT case_id FROM (${CASE_PEOPLE}) WHERE occupation = '教員'`],
  ["警察官の犯罪", `SELECT case_id FROM (${CASE_PEOPLE}) WHERE occupation = '警察官'`],
  ["医療・福祉職の犯罪", `SELECT case_id FROM (${CASE_PEOPLE}) WHERE occupation IN ('医療従事者','介護・福祉職')`],
  ["著名人", `SELECT case_id FROM (${CASE_PEOPLE}) WHERE public_figure IS NOT NULL`],
  ["子どもが被害者", `SELECT case_id FROM (${CASE_VICTIMS}) WHERE age_group IN ('10歳未満','10代')
                       UNION SELECT case_id FROM (${CASE_LAWS}) WHERE law_code IN ('child_porn','child_solicitation')`],
  ["高齢者が被害者", `SELECT case_id FROM (${CASE_VICTIMS}) WHERE age_group IN ('70代','80代','90代','100歳以上')`],
  ["DV・ストーカー", `SELECT case_id FROM (${CASE_LAWS}) WHERE law_code IN ('stalker','dv')`],
  ["性犯罪", `SELECT case_id FROM (${CASE_LAWS}) WHERE law_code IN ('sexual_assault','sexual_assault_injury','non_consensual_indecency','child_porn',
                                                                   'sexual_image_recording','child_solicitation')`],
  ["飲酒運転", `SELECT case_id FROM (${CASE_LAWS}) WHERE law_code IN ('dui','dui_drunk') OR raw_text LIKE '%飲酒%'`],
  ["あおり運転", `SELECT case_id FROM (${CASE_LAWS}) WHERE law_code = 'obstructive_driving'`],
  // 75 歳以上（年齢が分からなければ 80 代以上）の被疑者・被告人が、交通の罪に問われた事件
  ["高齢ドライバー", `SELECT p.case_id FROM (${CASE_PEOPLE}) p
                       WHERE (p.age >= 75 OR p.age_group IN ('80代','90代','100歳以上'))
                         AND p.case_id IN (SELECT cl.case_id FROM (${CASE_LAWS}) cl JOIN laws l ON l.code = cl.law_code WHERE l.group_name = '交通')`],
  ["サイバー犯罪", `SELECT case_id FROM (${CASE_LAWS}) WHERE law_code = 'unauthorized_access'`],
  ["薬物", `SELECT cl.case_id FROM (${CASE_LAWS}) cl JOIN laws l ON l.code = cl.law_code WHERE l.group_name = '薬物'`],
  ["外国人犯罪", `SELECT case_id FROM (${CASE_PEOPLE}) WHERE nationality IS NOT NULL AND nationality <> '日本' AND (nationality_code IS NULL OR nationality_code <> 'JP')`],
  ["少年事件", `SELECT id AS case_id FROM cases WHERE is_juvenile = 1{{C}}`],
  ["死刑判決", `SELECT case_id FROM judgments j WHERE sentence_type = '死刑'{{J}}`],
  ["無期判決", `SELECT case_id FROM judgments j WHERE sentence_type IN ('無期拘禁刑','無期懲役','無期禁錮'){{J}}`],
  ["無罪判決", `SELECT case_id FROM judgments j WHERE sentence_type = '無罪'{{J}}`],
  ["求刑超え", `SELECT case_id FROM judgments j WHERE ratio_to_demand > 1{{J}}`],
];

/**
 * 事件のテーマを計算し直す。caseId を省くと全件。
 * Muse が付けたテーマと自動のテーマを、集合演算の SQL でまとめて入れ直す（事件の数によらずクエリの数は一定）。
 * 1 件ごとの計算では、事件の絞り込みを各 SELECT の内側（{{R}} {{J}} {{C}}）に入れる。外側で絞ると、
 * SQLite が UNION の内側に条件を持ち込めず、毎回データベース全体を読んでしまう（D1 の読み取り上限を超えた原因）。
 */
export function scopeSql(sql: string, caseId?: string): string {
  return sql
    .replaceAll("{{R}}", caseId ? " AND r.case_id = ?1" : "")
    .replaceAll("{{J}}", caseId ? " AND j.case_id = ?1" : "")
    .replaceAll("{{C}}", caseId ? " AND id = ?1" : "");
}

/** 戻り値は D1 が数えた読み取り行数の合計（監視・テスト用） */
export async function recomputeThemes(db: D1Database, caseId?: string): Promise<number> {
  const one = caseId ? "WHERE case_id = ?1" : "";
  const caseArgs = caseId ? [caseId] : [];
  const stmts: D1PreparedStatement[] = [
    db.prepare(`DELETE FROM case_themes ${one}`).bind(...caseArgs),
    db
      .prepare(
        scopeSql(
          `INSERT OR IGNORE INTO case_themes (case_id, theme, source)
           SELECT case_id, theme, 'muse' FROM (
             SELECT r.case_id, it.theme FROM reports r CROSS JOIN item_themes it ON it.parent_type = 'report' AND it.parent_id = r.id WHERE 1=1{{R}}
             UNION SELECT j.case_id, it.theme FROM judgments j CROSS JOIN item_themes it ON it.parent_type = 'judgment' AND it.parent_id = j.id WHERE 1=1{{J}}
           )`,
          caseId,
        ),
      )
      .bind(...caseArgs),
    ...AUTO_RULES.map(([theme, sql]) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO case_themes (case_id, theme, source)
           SELECT DISTINCT case_id, ?2, 'auto' FROM (${scopeSql(sql, caseId)}) WHERE ?1 IS NULL OR case_id = ?1`,
        )
        .bind(caseId ?? null, theme),
    ),
  ];
  const results = await db.batch(stmts);
  return results.reduce((n, r) => n + (r.meta?.rows_read ?? 0), 0);
}
