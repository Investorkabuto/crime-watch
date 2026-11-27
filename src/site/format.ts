// 公開サイト用の表示整形・ラベル定義・統計ヘルパー
import { formatMonths } from "../normalize";
import type { Theme } from "../themes";

/** YYYY-MM-DD / ISO → 「2026年10月2日」 */
export function formatDateJa(iso: string | null | undefined): string {
  if (!iso) return "日付不明";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
}

/** YYYY-MM-DD / ISO → 「10/2」または「2026/10/2」 */
export function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso.slice(0, 10);
  return `${m[1]}/${Number(m[2])}/${Number(m[3])}`;
}

/** ISO 日時 → 「2026/10/2 14:30」 */
export function formatDateTimeShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (m) return `${m[1]}/${Number(m[2])}/${Number(m[3])} ${m[4]}:${m[5]}`;
  return formatDateShort(iso);
}

/** 金額（円）→ 「300万円」「50万円」「1億2,000万円」「50,000円」 */
export function formatYen(yen: number | null | undefined): string {
  if (yen == null) return "—";
  if (yen >= 100_000_000) {
    const oku = Math.floor(yen / 100_000_000);
    const man = Math.floor((yen % 100_000_000) / 10_000);
    return man > 0 ? `${oku}億${man.toLocaleString("ja-JP")}万円` : `${oku}億円`;
  }
  if (yen >= 10_000 && yen % 10_000 === 0) {
    return `${(yen / 10_000).toLocaleString("ja-JP")}万円`;
  }
  return `${yen.toLocaleString("ja-JP")}円`;
}

/** 判決の刑を 1 行の日本語に整形する */
export interface SentenceFields {
  sentence_type: string;
  term_months?: number | null;
  indeterminate_min_months?: number | null;
  indeterminate_max_months?: number | null;
  suspended_months?: number | null;
  probation?: number | null;
  fine_yen?: number | null;
  protective_disposition?: string | null;
}

export function formatSentence(j: SentenceFields): string {
  const parts: string[] = [];
  if (j.sentence_type === "保護処分") {
    return j.protective_disposition ? `保護処分（${j.protective_disposition}）` : "保護処分";
  }
  if (j.sentence_type === "死刑" || j.sentence_type === "無罪" || j.sentence_type.startsWith("無期")) {
    return j.sentence_type;
  }
  if (j.indeterminate_min_months != null && j.indeterminate_max_months != null) {
    parts.push(`${j.sentence_type} ${formatMonths(j.indeterminate_min_months)}以上${formatMonths(j.indeterminate_max_months)}以下`);
  } else if (j.term_months != null) {
    parts.push(`${j.sentence_type} ${formatMonths(j.term_months)}`);
  } else if (j.fine_yen != null) {
    parts.push(`${j.sentence_type} ${formatYen(j.fine_yen)}`);
  } else {
    parts.push(j.sentence_type);
  }
  if (j.suspended_months != null) {
    const susp = `執行猶予 ${formatMonths(j.suspended_months)}`;
    parts.push(j.probation ? `${susp}（保護観察付き）` : susp);
  }
  if (j.term_months != null && j.fine_yen != null) {
    parts.push(`罰金 ${formatYen(j.fine_yen)}`);
  }
  return parts.join("・");
}

/** 求刑を日本語に整形する */
export function formatDemand(j: {
  demand_type?: string | null;
  demand_months?: number | null;
  demand_fine_yen?: number | null;
}): string | null {
  if (!j.demand_type) return null;
  if (j.demand_months != null) return `${j.demand_type} ${formatMonths(j.demand_months)}`;
  if (j.demand_fine_yen != null) return `${j.demand_type} ${formatYen(j.demand_fine_yen)}`;
  return j.demand_type;
}

export function formatGender(g: string | null | undefined): string {
  if (g === "male") return "男性";
  if (g === "female") return "女性";
  return "記載なし";
}

export function formatAge(age: number | null | undefined, ageGroup: string | null | undefined): string {
  if (age != null) return `${age}歳`;
  if (ageGroup) return ageGroup;
  return "記載なし";
}

export function formatJuvenileClass(c: string | null | undefined): string | null {
  if (c === "juvenile") return "少年（18歳未満）";
  if (c === "specified_juvenile") return "特定少年（18・19歳）";
  if (c === "adult") return "成人";
  return null;
}

export function formatPlea(p: string | null | undefined): string | null {
  if (p === "admit") return "認めている";
  if (p === "deny") return "否認";
  if (p === "partial") return "一部否認";
  return null;
}

export function formatSettlement(s: string | null | undefined): string | null {
  if (s === "yes") return "成立";
  if (s === "no") return "不成立";
  return null;
}

export function formatHarmResult(h: string | null | undefined): string | null {
  if (h === "death") return "死亡";
  if (h === "serious") return "重傷";
  if (h === "minor") return "軽傷";
  if (h === "none") return "けがなし";
  return null;
}

export function formatModifier(m: string | null | undefined): string {
  if (m === "attempt") return "未遂";
  if (m === "accessory") return "幇助";
  if (m === "conspiracy") return "共謀";
  return "";
}

export function formatPct(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

/** 95% 信頼区間（t 分布の近似: n>=20 では t≈1.96〜2.09） */
export function ci95(values: number[]): { mean: number; low: number; high: number; n: number } | null {
  const n = values.length;
  if (n < 2) return null;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  const se = Math.sqrt(variance / n);
  // 自由度に応じた t_0.975 の簡易表（n>=20 が前提だが安全に補間）
  const t = n >= 120 ? 1.98 : n >= 60 ? 2.0 : n >= 30 ? 2.045 : n >= 20 ? 2.093 : 2.262;
  return {
    mean,
    low: mean - t * se,
    high: mean + t * se,
    n,
  };
}

/** CSV セルエスケープ */
export function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** テーマの区分と判定基準（要件 §13.8） */
export interface ThemeMeta {
  group: string;
  criteria: string;
}

export const THEME_META: Record<Theme, ThemeMeta> = {
  "闇バイト・トクリュウ": { group: "詐欺・強盗", criteria: "記事に「闇バイト」「トクリュウ」等の記載がある事件" },
  "特殊詐欺": { group: "詐欺・強盗", criteria: "罪状に「特殊詐欺」「オレオレ」「還付金詐欺」「架空請求」を含む事件、または記事に記載がある事件" },
  "SNS型投資詐欺": { group: "詐欺・強盗", criteria: "記事に SNS 型投資詐欺と記載がある事件" },
  "ロマンス詐欺": { group: "詐欺・強盗", criteria: "記事にロマンス詐欺と記載がある事件" },
  "強盗": { group: "詐欺・強盗", criteria: "強盗・強盗致傷・強盗殺人に該当する事件" },
  "公務員の犯罪": { group: "立場", criteria: "被疑者・被告人の職業が公務員・警察官・議員と報じられた事件" },
  "教員の犯罪": { group: "立場", criteria: "被疑者・被告人の職業が教員と報じられた事件" },
  "警察官の犯罪": { group: "立場", criteria: "被疑者・被告人の職業が警察官と報じられた事件" },
  "医療・福祉職の犯罪": { group: "立場", criteria: "被疑者・被告人の職業が医療従事者・介護・福祉職と報じられた事件" },
  "政治家・汚職": { group: "立場", criteria: "収賄・贈賄・公職選挙法違反、または議員・政治家と報じられた事件" },
  "企業犯罪": { group: "立場", criteria: "記事に企業・法人による組織的な犯罪と記載がある事件" },
  "著名人": { group: "立場", criteria: "被疑者・被告人に著名人の区分（歌手・俳優など）が記録された事件" },
  "子どもが被害者": { group: "被害者", criteria: "被害者が 10 歳未満・10 代、または児童買春・児童ポルノ禁止法違反の事件" },
  "高齢者が被害者": { group: "被害者", criteria: "被害者が 70 代以上と報じられた事件" },
  "児童虐待": { group: "被害者", criteria: "記事に児童虐待と記載がある事件" },
  "DV・ストーカー": { group: "被害者", criteria: "ストーカー規制法違反・DV 防止法違反に該当する事件" },
  "性犯罪": { group: "被害者", criteria: "不同意性交等・同致死傷・不同意わいせつ・児童買春・児童ポルノ禁止法違反に該当する事件" },
  "飲酒運転": { group: "交通", criteria: "酒気帯び運転・酒酔い運転、または罪状に「飲酒」を含む事件" },
  "あおり運転": { group: "交通", criteria: "妨害運転（あおり運転）に該当する事件" },
  "高齢ドライバー": { group: "交通", criteria: "交通の罪で、被疑者・被告人が 75 歳以上（年齢不明時は 80 代以上）と報じられた事件" },
  "ネット・SNSの犯罪": { group: "ネット", criteria: "記事にネット・SNS 上の犯罪と記載がある事件" },
  "誹謗中傷": { group: "ネット", criteria: "記事に誹謗中傷と記載がある事件" },
  "迷惑行為・迷惑系配信者": { group: "ネット", criteria: "記事に迷惑行為・迷惑系配信者と記載がある事件" },
  "サイバー犯罪": { group: "ネット", criteria: "不正アクセス禁止法違反に該当する事件、または記事に記載がある事件" },
  "薬物": { group: "その他", criteria: "覚醒剤取締法・大麻・麻薬関係の罪に該当する事件" },
  "外国人犯罪": { group: "その他", criteria: "記事に日本以外の国籍が明記された被疑者・被告人を含む事件（記載なしは日本国籍とみなさない）" },
  "少年事件": { group: "その他", criteria: "少年（18 歳未満・特定少年を含む）が関わる事件として報じられた事件" },
  "未解決事件": { group: "その他", criteria: "記事に未解決事件と記載がある事件" },
  "死刑判決": { group: "判決", criteria: "死刑が言い渡された判決を含む事件" },
  "無期判決": { group: "判決", criteria: "無期拘禁刑・無期懲役・無期禁錮が言い渡された判決を含む事件" },
  "無罪判決": { group: "判決", criteria: "無罪が言い渡された判決を含む事件" },
  "求刑超え": { group: "判決", criteria: "判決の刑期が検察の求刑を上回った（求刑比 100% 超）判決を含む事件" },
  "再審・冤罪": { group: "判決", criteria: "記事に再審・冤罪と記載がある事件" },
};

/** テーマのグループ一覧（表示順） */
export const THEME_GROUPS = ["詐欺・強盗", "立場", "被害者", "交通", "ネット", "その他", "判決"] as const;

/** 事件が確定しているか（確定前なら推定無罪の注記を出す） */
export function isFinalized(progress: string | null | undefined, latestStage: string | null | undefined): boolean {
  return progress === "確定" || latestStage === "確定" || progress === "不起訴";
}

/** 安全な http(s) URL か確認する */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** 今日の YYYY-MM-DD（JST） */
export function todayJst(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

/** N 日前の YYYY-MM-DD（JST） */
export function daysAgoJst(days: number): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000 - days * 86400 * 1000);
  return jst.toISOString().slice(0, 10);
}
