// 受信データの検証（schema/ingest.schema.json と同じ内容を zod で表現したもの）
import { z } from "zod";
import { RESIDENCE_STATUSES } from "./nationality";

export const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
  "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
  "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
  "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
] as const;

export const REPORT_STAGES = [
  "発生", "逮捕", "再逮捕", "送検", "起訴", "略式起訴", "処分保留", "不起訴", "家裁送致", "控訴", "上告", "確定",
] as const;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 形式で指定してください");
const dateTime = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
    "タイムゾーン付きの ISO 8601 で指定してください",
  );
const url = z.string().max(2000).regex(/^https?:\/\//, "http(s) の URL を指定してください");
const term = z
  .string()
  .min(2)
  .regex(/^(\d+年)?(\d+(月|か月|カ月|ヶ月))?$/, "「3年」「2年6月」の形式で指定してください");

const SENTENCE_TYPES = [
  "死刑", "無期拘禁刑", "無期懲役", "無期禁錮", "拘禁刑", "懲役", "禁錮", "罰金", "拘留", "科料",
  "無罪", "免訴", "公訴棄却", "保護処分",
] as const;
const DEMAND_TYPES = ["死刑", "無期拘禁刑", "無期懲役", "無期禁錮", "拘禁刑", "懲役", "禁錮", "罰金", "拘留", "科料"] as const;

// 粗い分類（記事に書かれる範囲。分からなければ送らない）
export const OCCUPATIONS = ["会社員", "会社役員", "公務員", "自営業", "アルバイト・パート", "無職", "学生", "その他", "不明"] as const;
export const VICTIM_RELATIONS = [
  "面識なし", "知人", "交際相手・元交際相手", "配偶者・元配偶者", "親族", "職場関係", "客・取引先", "その他", "不明",
] as const;
export const MOTIVES = ["金銭", "怨恨", "男女関係", "性的欲求", "生活困窮", "遊興費", "その他", "不明"] as const;
export const WEAPONS = ["なし", "刃物", "銃器", "鈍器", "車両", "その他", "不明"] as const;
export const LOCATION_TYPES = [
  "住宅", "路上", "店舗", "駅・交通機関", "職場", "学校", "公園", "車内", "インターネット", "その他", "不明",
] as const;

const victim = z.strictObject({
  gender: z.enum(["male", "female", "unknown"]).optional(),
  age_group: z.string().regex(/^(10歳未満|[1-9]0代|100歳以上)$/).optional(),
  occupation: z.enum(OCCUPATIONS).optional(),
  relation: z.enum(VICTIM_RELATIONS).optional(),
});

const circumstances = z.strictObject({
  motive: z.enum(MOTIVES).optional(),
  weapon: z.enum(WEAPONS).optional(),
  accomplice_count: z.number().int().min(0).max(100).optional(),
  location_type: z.enum(LOCATION_TYPES).optional(),
});

const person = z.strictObject({
  person_ref: z.string().min(1).max(100).optional(),
  gender: z.enum(["male", "female", "unknown"]).optional(),
  age: z.number().int().min(0).max(120).optional(),
  age_group: z.string().regex(/^(10歳未満|[1-9]0代|100歳以上)$/).optional(),
  juvenile_class: z.enum(["juvenile", "specified_juvenile", "adult", "unknown"]).optional(),
  occupation: z.enum(OCCUPATIONS).optional(),
  // 記事に明記された国籍だけを入れる（「ベトナム国籍」「ベトナム」など記事の表記でよい）。書かれていなければ送らない
  nationality: z.string().min(1).max(30).optional(),
  residence_status: z.enum(RESIDENCE_STATUSES).optional(),
});

const common = {
  external_id: z.string().min(1).max(200),
  case_ref: z.string().min(1).max(200),
  link_confidence: z.enum(["high", "low"]).optional(),
  backfill: z.boolean().optional(),
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(2000),
  charges: z.array(z.string().min(1).max(200)).min(1),
  is_juvenile: z.boolean(),
  source_url: url,
  source_name: z.string().optional(),
  additional_sources: z.array(z.strictObject({ url, name: z.string().optional() })).optional(),
  victims: z.array(victim).max(100).optional(),
  circumstances: circumstances.optional(),
};

export const reportSchema = z
  .strictObject({
    type: z.literal("report"),
    ...common,
    // 控訴・上告・確定は「被告側が控訴した」「判決が確定した」などの報道（判決そのものは judgment で送る）
    // 不起訴・処分保留・略式起訴・家裁送致は、事件がそこで終わる（または家裁に移る）ことを表す報道
    stage: z.enum(REPORT_STAGES),
    non_prosecution_reason: z.enum(["起訴猶予", "嫌疑不十分", "嫌疑なし", "不明"]).optional(),
    reported_at: dateTime,
    occurred_on: date.optional(),
    prefecture: z.enum(PREFECTURES),
    city: z.string().max(50).optional(),
    police_agency: z.string().max(50).optional(),
    police_station: z.string().max(50).optional(),
    prosecutor_office: z.string().max(50).optional(),
    suspects: z.array(person.extend({ plea: z.enum(["admit", "deny", "partial", "unknown"]).optional() })).optional(),
  });

export const judgmentSchema = z
  .strictObject({
    type: z.literal("judgment"),
    ...common,
    court: z.string().min(1).max(100),
    instance: z.enum(["一審", "控訴審", "上告審", "家裁審判", "略式命令"]).nullable().optional(),
    decided_on: date,
    reported_at: dateTime.optional(),
    occurred_on: date.optional(),
    prefecture: z.enum(PREFECTURES).optional(),
    city: z.string().max(50).optional(),
    police_agency: z.string().max(50).optional(),
    prosecutor_office: z.string().max(50).optional(),
    judges: z
      .array(
        z.strictObject({
          name: z.string().min(1).max(50),
          role: z.enum(["裁判長", "右陪席", "左陪席", "単独", "不明"]),
        }),
      )
      .optional(),
    lay_judge_trial: z.boolean().nullable().optional(),
    sentence: z.strictObject({
      type: z.enum(SENTENCE_TYPES),
      term: term.optional(),
      indeterminate: z.strictObject({ min: term, max: term }).optional(),
      suspended: term.optional(),
      probation: z.boolean().optional(),
      fine_yen: z.number().int().min(0).optional(),
      detention_credit_days: z.number().int().min(0).optional(),
      other: z.string().max(500).optional(),
      protective_disposition: z
        .enum(["保護観察", "少年院送致", "児童自立支援施設等送致", "不処分", "審判不開始", "検察官送致"])
        .optional(),
    }),
    demand: z
      .strictObject({
        type: z.enum(DEMAND_TYPES),
        term: term.optional(),
        fine_yen: z.number().int().min(0).optional(),
      })
      .optional(),
    defendant: person.optional(),
    factors: z
      .strictObject({
        prior_record: z.enum(["none", "yes", "same_kind", "unknown"]).optional(),
        plea: z.enum(["admit", "deny", "partial", "unknown"]).optional(),
        settlement: z.enum(["yes", "no", "unknown"]).optional(),
        damage_yen: z.number().int().min(0).optional(),
        victim_count: z.number().int().min(0).optional(),
        harm_result: z.enum(["death", "serious", "minor", "none", "unknown"]).optional(),
        adjustments: z.array(z.string()).optional(),
      })
      .optional(),
    appeal_status: z.enum(["控訴", "上告", "確定", "不明"]).optional(),
  });

export const itemSchema = z.discriminatedUnion("type", [reportSchema, judgmentSchema]);

export type ReportItem = z.infer<typeof reportSchema>;
export type JudgmentItem = z.infer<typeof judgmentSchema>;
export type IngestItem = z.infer<typeof itemSchema>;

export const MAX_ITEMS = 100;
