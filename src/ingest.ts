// 受信データの取り込み（要件 F1〜F5, F10）
import { normalizePoliceAgency, normalizePoliceStation, normalizeProsecutorOffice } from "./agencies";
import { classifyCharges, type AliasMap, type ClassifiedCharge } from "./classify";
import { normalizeNationality } from "./nationality";
import { recomputeThemes } from "./themes";
import { courtLevel, courtPrefecture, normalizeCourtName } from "./courts";
import { periodAt, positionInRange, ratioToDemand, severity, type PenaltyPeriod } from "./metrics";
import { ageToGroup, ageToJuvenileClass, normalizePersonName, nowIso, parseTermMonths } from "./normalize";
import { detectPii, type Flag } from "./pii";
import { itemSchema, type IngestItem, type JudgmentItem, type ReportItem } from "./schema";

/** 被害者の情報を特に慎重に扱う罪（性犯罪） */
export const SEX_CRIME_LAWS = new Set([
  "sexual_assault", "sexual_assault_injury", "non_consensual_indecency", "child_porn", "sexual_image_recording", "child_solicitation",
]);

export interface ItemResult {
  index: number;
  external_id: string | null;
  status: "created" | "updated" | "rejected";
  errors?: { path: string; message: string }[];
  unclassified_charges?: string[];
  flags?: number;
}

export interface Dictionary {
  aliases: AliasMap;
  periods: PenaltyPeriod[];
}

export async function loadDictionary(db: D1Database): Promise<Dictionary> {
  const [aliases, periods] = await db.batch([
    db.prepare("SELECT alias, law_code FROM charge_aliases"),
    db.prepare(
      "SELECT law_code, effective_from, effective_to, stat_min_months, stat_max_months, stat_has_death, stat_has_life FROM law_penalty_periods",
    ),
  ]);
  const map: AliasMap = new Map();
  for (const r of (aliases?.results ?? []) as { alias: string; law_code: string }[]) map.set(r.alias, r.law_code);
  return { aliases: map, periods: (periods?.results ?? []) as PenaltyPeriod[] };
}

const json = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));
const bool = (v: boolean | null | undefined) => (v === undefined || v === null ? null : v ? 1 : 0);

/** 1 件の取り込み。検証エラーは rejected として返す（例外にしない） */
export async function ingestItem(db: D1Database, dict: Dictionary, raw: unknown, index: number): Promise<ItemResult> {
  const externalId =
    raw && typeof raw === "object" && typeof (raw as Record<string, unknown>).external_id === "string"
      ? ((raw as Record<string, unknown>).external_id as string)
      : null;
  const parsed = itemSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      index,
      external_id: externalId,
      status: "rejected",
      errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    };
  }
  const item = parsed.data;
  const charges = classifyCharges(item.charges, dict.aliases);
  const isSexCrime = charges.some((c) => c.lawCode !== null && SEX_CRIME_LAWS.has(c.lawCode));
  const flags = detectPii({ title: item.title, summary: item.summary }, { isJuvenile: item.is_juvenile, isSexCrime });
  const now = nowIso();

  const caseId = await upsertCase(db, item.case_ref, item.title, item.summary, item.is_juvenile, now);
  const status =
    item.type === "report"
      ? await upsertReport(db, item, caseId, charges, flags, now)
      : await upsertJudgment(db, dict, item, caseId, charges, flags, now);
  await refreshCase(db, caseId, now);

  const unclassified = charges.filter((c) => !c.lawCode).map((c) => c.text);
  return {
    index,
    external_id: item.external_id,
    status,
    ...(unclassified.length ? { unclassified_charges: unclassified } : {}),
    ...(flags.length ? { flags: flags.length } : {}),
  };
}

async function upsertCase(
  db: D1Database,
  caseRef: string,
  title: string,
  summary: string,
  isJuvenile: boolean,
  now: string,
): Promise<string> {
  // 少年事件の印は一度付いたら外さない（後続の報道で付け忘れても市区町村などを出さないため）
  const row = await db
    .prepare(
      `INSERT INTO cases (id, case_ref, title, summary, is_juvenile, latest_stage, latest_at, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, '不明', ?6, ?6, ?6)
       ON CONFLICT(case_ref) DO UPDATE SET updated_at = excluded.updated_at,
         is_juvenile = MAX(cases.is_juvenile, excluded.is_juvenile)
       RETURNING id`,
    )
    .bind(crypto.randomUUID(), caseRef, title, summary, isJuvenile ? 1 : 0, now)
    .first<{ id: string }>();
  if (!row) throw new Error("failed to upsert case");
  return row.id;
}

type Circumstances = IngestItem["circumstances"];
type Victims = IngestItem["victims"];

function circumstanceValues(c: Circumstances): (string | number | null)[] {
  return [c?.motive ?? null, c?.weapon ?? null, c?.accomplice_count ?? null, c?.location_type ?? null];
}

/** Muse が付けたテーマを入れ直す */
function themeStatements(db: D1Database, parentType: "report" | "judgment", parentId: string, themes: IngestItem["themes"]) {
  return [
    db.prepare("DELETE FROM item_themes WHERE parent_type = ? AND parent_id = ?").bind(parentType, parentId),
    ...[...new Set(themes ?? [])].map((t) =>
      db.prepare("INSERT INTO item_themes (parent_type, parent_id, theme) VALUES (?, ?, ?)").bind(parentType, parentId, t),
    ),
  ];
}

/** 被害者の粗い属性を入れ直す */
function victimStatements(db: D1Database, parentType: "report" | "judgment", parentId: string, victims: Victims) {
  return [
    db.prepare("DELETE FROM victims WHERE parent_type = ? AND parent_id = ?").bind(parentType, parentId),
    ...(victims ?? []).map((v, i) =>
      db
        .prepare(
          "INSERT INTO victims (parent_type, parent_id, seq, gender, age_group, occupation, relation) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(parentType, parentId, i, v.gender ?? null, v.age_group ?? null, v.occupation ?? null, v.relation ?? null),
    ),
  ];
}

async function existingId(db: D1Database, table: "reports" | "judgments", externalId: string): Promise<string | null> {
  const r = await db.prepare(`SELECT id FROM ${table} WHERE external_id = ?`).bind(externalId).first<{ id: string }>();
  return r?.id ?? null;
}

function chargeStatements(db: D1Database, table: "report_charges" | "judgment_charges", parentCol: string, parentId: string, charges: ClassifiedCharge[], primaryIdx: number | null) {
  return charges.map((c, i) =>
    table === "report_charges"
      ? db
          .prepare(
            `INSERT INTO report_charges (${parentCol}, seq, charge_text, raw_text, law_code, modifier, matched_alias) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(parentId, i, c.text, c.raw, c.lawCode, c.modifier, c.matchedAlias)
      : db
          .prepare(
            `INSERT INTO judgment_charges (${parentCol}, seq, charge_text, raw_text, law_code, modifier, matched_alias, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(parentId, i, c.text, c.raw, c.lawCode, c.modifier, c.matchedAlias, i === primaryIdx ? 1 : 0),
  );
}

async function upsertReport(
  db: D1Database,
  item: ReportItem,
  caseId: string,
  charges: ClassifiedCharge[],
  flags: Flag[],
  now: string,
): Promise<"created" | "updated"> {
  const found = await existingId(db, "reports", item.external_id);
  const id = found ?? crypto.randomUUID();
  const city = item.city ?? null;
  const police = normalizePoliceAgency(item.police_agency);
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO reports (id, external_id, case_id, stage, title, summary, reported_at, occurred_on, prefecture, city,
           link_confidence, backfill, source_url, source_name, additional_sources, flags, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?17)
         ON CONFLICT(external_id) DO UPDATE SET
           case_id = excluded.case_id, stage = excluded.stage, title = excluded.title, summary = excluded.summary,
           reported_at = excluded.reported_at, occurred_on = excluded.occurred_on, prefecture = excluded.prefecture,
           city = excluded.city, link_confidence = excluded.link_confidence, backfill = excluded.backfill,
           source_url = excluded.source_url, source_name = excluded.source_name,
           additional_sources = excluded.additional_sources, flags = excluded.flags, updated_at = excluded.updated_at`,
      )
      .bind(
        id, item.external_id, caseId, item.stage, item.title, item.summary, item.reported_at, item.occurred_on ?? null,
        item.prefecture, city, item.link_confidence ?? null, item.backfill ? 1 : 0, item.source_url,
        item.source_name ?? null, json(item.additional_sources), flags.length ? JSON.stringify(flags) : null, now,
      ),
    db
      .prepare(
        `UPDATE reports SET police_agency = ?, police_prefecture = ?, police_station = ?, prosecutor_office = ?,
           motive = ?, weapon = ?, accomplice_count = ?, location_type = ?, non_prosecution_reason = ?,
           archive_url = ?, evidence_quote = ? WHERE id = ?`,
      )
      .bind(
        police?.name ?? null, police?.prefecture ?? null,
        normalizePoliceStation(item.police_station),
        normalizeProsecutorOffice(item.prosecutor_office), ...circumstanceValues(item.circumstances),
        item.non_prosecution_reason ?? null, item.archive_url ?? null, item.evidence_quote ?? null, id,
      ),
    ...victimStatements(db, "report", id, item.victims),
    ...themeStatements(db, "report", id, item.themes),
    db.prepare("DELETE FROM report_charges WHERE report_id = ?").bind(id),
    db.prepare("DELETE FROM report_persons WHERE report_id = ?").bind(id),
    ...chargeStatements(db, "report_charges", "report_id", id, charges, null),
    ...(item.suspects ?? []).map((p, i) =>
      db
        .prepare(
          `INSERT INTO report_persons (report_id, seq, person_ref, gender, age, age_group, juvenile_class, plea, occupation,
             nationality, nationality_code, residence_status, public_figure) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id, i, p.person_ref ?? null, p.gender ?? null, p.age ?? null,
          p.age_group ?? ageToGroup(p.age),
          p.juvenile_class ?? ageToJuvenileClass(p.age) ?? (item.is_juvenile ? "juvenile" : null),
          p.plea ?? null,
          p.occupation ?? null,
          normalizeNationality(p.nationality)?.name ?? null,
          normalizeNationality(p.nationality)?.code ?? null,
          p.residence_status ?? null,
          p.public_figure ?? null,
        ),
    ),
  ];
  await db.batch(stmts);
  return found ? "updated" : "created";
}

async function upsertCourt(db: D1Database, rawName: string): Promise<string> {
  const name = normalizeCourtName(rawName);
  const row = await db
    .prepare(
      `INSERT INTO courts (id, name, level, prefecture) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(name) DO UPDATE SET name = excluded.name RETURNING id`,
    )
    .bind(crypto.randomUUID(), name, courtLevel(name), courtPrefecture(name))
    .first<{ id: string }>();
  if (!row) throw new Error("failed to upsert court");
  return row.id;
}

async function findOrCreateJudge(db: D1Database, rawName: string): Promise<string> {
  const name = normalizePersonName(rawName);
  // 名寄せ（同姓同名の分離）は管理画面で行う。ここでは名前の一致で同一人物とみなす
  const found = await db.prepare("SELECT id FROM judges WHERE name = ? ORDER BY rowid LIMIT 1").bind(name).first<{ id: string }>();
  if (found) return found.id;
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO judges (id, name) VALUES (?, ?)").bind(id, name).run();
  return id;
}

/** 同じ事件の確度の高い報道から、同じ人物（person_ref）の性別を引き継ぐ */
async function inheritGender(db: D1Database, caseId: string, personRef: string | undefined): Promise<string | null> {
  if (!personRef) return null;
  const r = await db
    .prepare(
      `SELECT p.gender FROM report_persons p JOIN reports r ON r.id = p.report_id
       WHERE r.case_id = ? AND p.person_ref = ? AND p.gender IN ('male','female')
         AND (r.link_confidence IS NULL OR r.link_confidence = 'high')
       ORDER BY r.reported_at DESC LIMIT 1`,
    )
    .bind(caseId, personRef)
    .first<{ gender: string }>();
  return r?.gender ?? null;
}

async function upsertJudgment(
  db: D1Database,
  dict: Dictionary,
  item: JudgmentItem,
  caseId: string,
  charges: ClassifiedCharge[],
  flags: Flag[],
  now: string,
): Promise<"created" | "updated"> {
  const found = await existingId(db, "judgments", item.external_id);
  const id = found ?? crypto.randomUUID();
  const courtId = await upsertCourt(db, item.court);
  const judgeRows: { judgeId: string; role: string }[] = [];
  for (const j of item.judges ?? []) judgeRows.push({ judgeId: await findOrCreateJudge(db, j.name), role: j.role });

  // 行為時点の法定刑で、最も重い罪を基準にする
  const caseRow = await db.prepare("SELECT occurred_on FROM cases WHERE id = ?").bind(caseId).first<{ occurred_on: string | null }>();
  const offenseDate = item.occurred_on ?? caseRow?.occurred_on ?? item.decided_on;
  let primaryIdx: number | null = null;
  let primaryPeriod: PenaltyPeriod | null = null;
  charges.forEach((c, i) => {
    if (!c.lawCode) return;
    const p = periodAt(dict.periods, c.lawCode, offenseDate);
    if (primaryIdx === null || severity(p) > severity(primaryPeriod)) {
      primaryIdx = i;
      primaryPeriod = p;
    }
  });
  const primaryLaw = primaryIdx !== null ? (charges[primaryIdx]?.lawCode ?? null) : null;

  const s = item.sentence;
  const termMonths = parseTermMonths(s.term);
  const demandMonths = parseTermMonths(item.demand?.term);
  const d = item.defendant;
  let gender: string | null = d?.gender && d.gender !== "unknown" ? d.gender : null;
  let inherited = 0;
  if (!gender && item.link_confidence !== "low") {
    gender = await inheritGender(db, caseId, d?.person_ref);
    inherited = gender ? 1 : 0;
  }
  const age = d?.age ?? null;
  const police = normalizePoliceAgency(item.police_agency);
  // 国籍・在留資格は判決報道に書かれないことが多いので、性別と同じく確度の高い逮捕報道から引き継ぐ
  let nat = normalizeNationality(d?.nationality);
  let residence: string | null = d?.residence_status ?? null;
  let natInherited = 0;
  if ((!nat || !residence) && item.link_confidence !== "low" && d?.person_ref) {
    const prev = await db
      .prepare(
        `SELECT p.nationality, p.nationality_code, p.residence_status FROM report_persons p JOIN reports r ON r.id = p.report_id
         WHERE r.case_id = ? AND p.person_ref = ? AND (p.nationality IS NOT NULL OR p.residence_status IS NOT NULL)
           AND (r.link_confidence IS NULL OR r.link_confidence = 'high')
         ORDER BY r.reported_at DESC LIMIT 1`,
      )
      .bind(caseId, d.person_ref)
      .first<{ nationality: string | null; nationality_code: string | null; residence_status: string | null }>();
    if (prev) {
      if (!nat && prev.nationality) {
        nat = { name: prev.nationality, code: prev.nationality_code };
        natInherited = 1;
      }
      if (!residence && prev.residence_status) {
        residence = prev.residence_status;
        natInherited = 1;
      }
    }
  }

  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO judgments (id, external_id, case_id, court_id, instance, decided_on, reported_at, occurred_on,
           link_confidence, backfill, lay_judge_trial, sentence_type, term_months, indeterminate_min_months,
           indeterminate_max_months, suspended_months, probation, fine_yen, detention_credit_days, other_dispositions,
           protective_disposition, demand_type, demand_months, demand_fine_yen, appeal_status, person_ref,
           defendant_gender, gender_inherited, defendant_age, defendant_age_group, juvenile_class, prior_record, plea,
           settlement, damage_yen, victim_count, harm_result, adjustments, primary_law_code, position_in_range,
           ratio_to_demand, title, summary, source_url, source_name, additional_sources, flags, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22,
           ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31, ?32, ?33, ?34, ?35, ?36, ?37, ?38, ?39, ?40, ?41, ?42, ?43,
           ?44, ?45, ?46, ?47, ?48, ?48)
         ON CONFLICT(external_id) DO UPDATE SET
           case_id = excluded.case_id, court_id = excluded.court_id, instance = excluded.instance,
           decided_on = excluded.decided_on, reported_at = excluded.reported_at, occurred_on = excluded.occurred_on,
           link_confidence = excluded.link_confidence, backfill = excluded.backfill,
           lay_judge_trial = excluded.lay_judge_trial, sentence_type = excluded.sentence_type,
           term_months = excluded.term_months, indeterminate_min_months = excluded.indeterminate_min_months,
           indeterminate_max_months = excluded.indeterminate_max_months, suspended_months = excluded.suspended_months,
           probation = excluded.probation, fine_yen = excluded.fine_yen,
           detention_credit_days = excluded.detention_credit_days, other_dispositions = excluded.other_dispositions,
           protective_disposition = excluded.protective_disposition, demand_type = excluded.demand_type,
           demand_months = excluded.demand_months, demand_fine_yen = excluded.demand_fine_yen,
           appeal_status = excluded.appeal_status, person_ref = excluded.person_ref,
           defendant_gender = excluded.defendant_gender, gender_inherited = excluded.gender_inherited,
           defendant_age = excluded.defendant_age, defendant_age_group = excluded.defendant_age_group,
           juvenile_class = excluded.juvenile_class, prior_record = excluded.prior_record, plea = excluded.plea,
           settlement = excluded.settlement, damage_yen = excluded.damage_yen, victim_count = excluded.victim_count,
           harm_result = excluded.harm_result, adjustments = excluded.adjustments,
           primary_law_code = excluded.primary_law_code, position_in_range = excluded.position_in_range,
           ratio_to_demand = excluded.ratio_to_demand, title = excluded.title, summary = excluded.summary,
           source_url = excluded.source_url, source_name = excluded.source_name,
           additional_sources = excluded.additional_sources, flags = excluded.flags, updated_at = excluded.updated_at`,
      )
      .bind(
        id, item.external_id, caseId, courtId, item.instance ?? null, item.decided_on, item.reported_at ?? null,
        item.occurred_on ?? null, item.link_confidence ?? null, item.backfill ? 1 : 0, bool(item.lay_judge_trial),
        s.type, termMonths, parseTermMonths(s.indeterminate?.min), parseTermMonths(s.indeterminate?.max),
        parseTermMonths(s.suspended), bool(s.probation), s.fine_yen ?? null, s.detention_credit_days ?? null,
        s.other ?? null, s.protective_disposition ?? null, item.demand?.type ?? null, demandMonths,
        item.demand?.fine_yen ?? null, item.appeal_status ?? "不明", d?.person_ref ?? null, gender ?? (d?.gender ?? null),
        inherited, age, d?.age_group ?? ageToGroup(age),
        d?.juvenile_class ?? ageToJuvenileClass(age) ?? (item.is_juvenile ? "juvenile" : null),
        item.factors?.prior_record ?? null, item.factors?.plea ?? null, item.factors?.settlement ?? null,
        item.factors?.damage_yen ?? null, item.factors?.victim_count ?? null, item.factors?.harm_result ?? null,
        json(item.factors?.adjustments), primaryLaw, positionInRange(s.type, termMonths, primaryPeriod),
        ratioToDemand(s.type, termMonths, item.demand?.type ?? null, demandMonths), item.title, item.summary,
        item.source_url, item.source_name ?? null, json(item.additional_sources),
        flags.length ? JSON.stringify(flags) : null, now,
      ),
    db
      .prepare(
        `UPDATE judgments SET prefecture = ?, city = ?, police_agency = ?, police_prefecture = ?, prosecutor_office = ?,
           motive = ?, weapon = ?, accomplice_count = ?, location_type = ?, defendant_occupation = ?,
           defendant_nationality = ?, defendant_nationality_code = ?, defendant_residence_status = ?, nationality_inherited = ?,
           defendant_public_figure = ?, archive_url = ?, evidence_quote = ?
         WHERE id = ?`,
      )
      .bind(
        item.prefecture ?? null, item.city ?? null, police?.name ?? null,
        police?.prefecture ?? null, normalizeProsecutorOffice(item.prosecutor_office),
        ...circumstanceValues(item.circumstances), d?.occupation ?? null,
        nat?.name ?? null, nat?.code ?? null, residence, natInherited, d?.public_figure ?? null,
        item.archive_url ?? null, item.evidence_quote ?? null, id,
      ),
    ...victimStatements(db, "judgment", id, item.victims),
    ...themeStatements(db, "judgment", id, item.themes),
    db.prepare("DELETE FROM judgment_charges WHERE judgment_id = ?").bind(id),
    db.prepare("DELETE FROM judgment_judges WHERE judgment_id = ?").bind(id),
    ...chargeStatements(db, "judgment_charges", "judgment_id", id, charges, primaryIdx),
    ...judgeRows.map((j) =>
      db.prepare("INSERT OR IGNORE INTO judgment_judges (judgment_id, judge_id, role) VALUES (?, ?, ?)").bind(id, j.judgeId, j.role),
    ),
  ];
  await db.batch(stmts);
  return found ? "updated" : "created";
}

/** 最新の段階から、事件の進み具合を決める */
export function progressOf(stage: string): string | null {
  switch (stage) {
    case "発生":
    case "逮捕":
    case "再逮捕":
    case "送検":
      return "捜査中";
    case "処分保留":
      return "処分保留";
    case "起訴":
      return "公判中";
    case "略式起訴":
    case "略式命令":
      return "略式手続";
    case "判決":
    case "控訴":
    case "上告":
      return "判決後（未確定）";
    case "確定":
      return "確定";
    case "不起訴":
      return "不起訴";
    case "家裁送致":
      return "家裁送致";
    default:
      return null;
  }
}

/** 事件の表示用の値（最新の段階・日付・都道府県など）を、ひも付いた報道・判決から計算し直す */
export async function refreshCase(db: D1Database, caseId: string, now: string): Promise<void> {
  const [reports, judgments] = await db.batch([
    db.prepare(
      `SELECT r.stage, r.title, r.summary, r.reported_at AS at, r.occurred_on, r.prefecture, r.city, r.backfill, r.flags,
              CASE WHEN r.flags IS NOT NULL AND NOT EXISTS (SELECT 1 FROM flag_reviews fr WHERE fr.parent_type = 'report' AND fr.parent_id = r.id AND fr.reviewed_flags = r.flags) THEN 1 ELSE 0 END AS pending,
              (SELECT COUNT(*) FROM report_persons p WHERE p.report_id = r.id AND p.juvenile_class IN ('juvenile','specified_juvenile')) AS juv
       FROM reports r WHERE r.case_id = ?`,
    ).bind(caseId),
    db.prepare(
      `SELECT j.appeal_status, j.instance, j.title, j.summary, j.decided_on AS at, j.occurred_on, j.prefecture, j.city,
              c.prefecture AS court_prefecture, j.backfill, j.flags,
              CASE WHEN j.flags IS NOT NULL AND NOT EXISTS (SELECT 1 FROM flag_reviews fr WHERE fr.parent_type = 'judgment' AND fr.parent_id = j.id AND fr.reviewed_flags = j.flags) THEN 1 ELSE 0 END AS pending,
              CASE WHEN j.juvenile_class IN ('juvenile','specified_juvenile') THEN 1 ELSE 0 END AS juv
       FROM judgments j JOIN courts c ON c.id = j.court_id WHERE j.case_id = ?`,
    ).bind(caseId),
  ]);
  type Ev = { stage: string; title: string; summary: string; at: string; occurred_on: string | null; prefecture: string | null; city: string | null; court_prefecture?: string | null; backfill: number; flags: string | null; pending: number; juv: number };
  const events: Ev[] = [
    ...((reports?.results ?? []) as Ev[]),
    ...((judgments?.results ?? []) as (Omit<Ev, "stage"> & { appeal_status: string; instance: string | null })[]).map((j) => ({
      ...j,
      stage: j.appeal_status === "確定" ? "確定" : j.instance === "略式命令" ? "略式命令" : "判決",
    })),
  ];
  if (!events.length) return;
  // 判決日は日付のみなので、同じ日の報道より後として扱う
  const key = (e: Ev) => (e.at.length === 10 ? `${e.at}T23:59:59+09:00` : e.at);
  events.sort((a, b) => (Date.parse(key(a)) || 0) - (Date.parse(key(b)) || 0));
  const latest = events[events.length - 1]!;
  const occurred = events.map((e) => e.occurred_on).filter((v): v is string => !!v).sort()[0] ?? null;
  // 発生場所の都道府県を優先し、どこにもなければ裁判所（地裁・家裁）の所在地で代用する
  const prefecture =
    events.find((e) => e.prefecture)?.prefecture ?? events.find((e) => e.court_prefecture)?.court_prefecture ?? null;
  const current = await db.prepare("SELECT is_juvenile FROM cases WHERE id = ?").bind(caseId).first<{ is_juvenile: number }>();
  const juvenile = (current?.is_juvenile ?? 0) === 1 || events.some((e) => e.juv > 0);
  const city = events.find((e) => e.city)?.city ?? null;
  await db
    .prepare(
      `UPDATE cases SET title = ?2, summary = ?3, latest_stage = ?4, latest_at = ?5, occurred_on = ?6, prefecture = ?7,
         city = ?8, is_juvenile = ?9, backfill = ?10, flagged = ?11, updated_at = ?12, progress = ?13 WHERE id = ?1`,
    )
    .bind(
      caseId, latest.title, latest.summary, latest.stage, key(latest), occurred, prefecture, city, juvenile ? 1 : 0,
      events.every((e) => e.backfill === 1) ? 1 : 0, events.some((e) => e.pending === 1) ? 1 : 0, now,
      progressOf(latest.stage),
    )
    .run();
  await recomputeThemes(db, caseId);
}
