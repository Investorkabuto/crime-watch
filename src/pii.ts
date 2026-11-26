// 自動チェック（要件 §9-8）。公開は止めず、検出内容を flags として記録し管理者が事後に確認する。

export interface Flag {
  kind: "person_name" | "phone" | "street_address" | "school" | "juvenile_detail";
  field: string;
  match: string;
}

// 「◯◯容疑者」「◯◯被告」などの直前にある語のうち、人名ではないもの
const NON_NAME_PREFIXES = [
  "男", "女", "男性", "女性", "少年", "少女", "会社員", "会社役員", "無職", "自称", "元", "同", "両",
  "職業不詳", "アルバイト", "パート", "自営業", "公務員", "教員", "医師", "看護師", "学生", "高校生",
  "大学生", "中学生", "被告", "容疑者", "外国籍", "住所不定", "店員", "社長", "代表", "役員", "従業員",
  "運転手", "警察官", "巡査", "巡査長", "巡査部長", "警部補", "警部", "当時", "夫", "妻", "父親", "母親",
  "長男", "長女", "次男", "次女", "祖父", "祖母", "孫",
];

const NAME_SUFFIX_RE = /([一-龯々ヶ]{1,4}[ 　]?[一-龯々ヶぁ-んァ-ヴー]{1,5})(容疑者|被告人|被告|受刑者|死刑囚|さん|氏|ちゃん|くん)/g;
const PHONE_RE = /0\d{1,4}[-ー－]\d{1,4}[-ー－]\d{3,4}/g;
const STREET_RE = /(\d+|[一二三四五六七八九十]+)丁目\d+(番地?|[-ー－]\d+)|\d+番地/g;
// 「高校生」「中学生」のような身分の表記は除き、学校名（「○○中学校」）を検出する
const SCHOOL_RE = /[^\s、。「」（）()]{1,10}?(小学校|中学校|高等学校|高校|大学|専門学校|特別支援学校)(?!生)/g;

function scanNames(field: string, text: string, flags: Flag[]): void {
  for (const m of text.matchAll(NAME_SUFFIX_RE)) {
    const candidate = m[1] ?? "";
    // 直前語が人名でない語で終わる場合（「無職の男」→「男容疑者」等）は除外
    if (NON_NAME_PREFIXES.some((p) => candidate === p || candidate.endsWith(p))) continue;
    flags.push({ kind: "person_name", field, match: m[0] });
  }
}

/** title・summary などの文章を検査する */
export function detectPii(fields: Record<string, string | undefined | null>, isJuvenile: boolean): Flag[] {
  const flags: Flag[] = [];
  for (const [field, text] of Object.entries(fields)) {
    if (!text) continue;
    scanNames(field, text, flags);
    for (const m of text.matchAll(PHONE_RE)) flags.push({ kind: "phone", field, match: m[0] });
    for (const m of text.matchAll(STREET_RE)) flags.push({ kind: "street_address", field, match: m[0] });
    if (isJuvenile) {
      for (const m of text.matchAll(SCHOOL_RE)) flags.push({ kind: "school", field, match: m[0] });
      for (const m of text.matchAll(/\d{1,2}歳|[(（]\d{1,2}[)）]/g)) {
        flags.push({ kind: "juvenile_detail", field, match: m[0] });
      }
    }
  }
  return flags;
}
