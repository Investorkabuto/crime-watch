// 自動チェック（要件 §9-8）。公開は止めず、検出内容を flags として記録し管理者が事後に確認する。

export interface Flag {
  kind: "person_name" | "phone" | "street_address" | "school" | "juvenile_detail" | "victim_age" | "victim_relation";
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

// 候補にこれらを含む場合は人名ではない（罪名・裁判所・捜査機関・述語）
const NOT_NAME_WORDS = /(罪|裁判|地裁|高裁|家裁|簡裁|最高裁|警察|県警|府警|検察|地検|署|庁|問われ|起訴され|とされ|された|られた)/;

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
    // 「和歌山地裁は被告」「会社役員の被告」のように、漢字の語に助詞が付いて「被告」に続く形は人名ではない
    // （「山田あやの被告」のように仮名を含む名前は対象外にしないため、漢字だけの語＋助詞 1 文字に限る）
    if (/^[一-龯々ヶ]+[のはにをがでともへ]$/.test(candidate)) continue;
    // 「殺人罪に問われた被告」「那覇地裁の被告」のように、罪名や機関名を含むものは人名ではない
    if (NOT_NAME_WORDS.test(candidate)) continue;
    flags.push({ kind: "person_name", field, match: m[0] });
  }
}

/** title・summary などの文章を検査する */
/** 性犯罪で、被告人との関係から被害者が分かってしまう表現 */
const VICTIM_RELATION_RE = /(実の|義理の)?(娘|長女|次女|三女|孫娘|孫|姪|養女|継娘|連れ子|妹|教え子|生徒|児童|部下|患者|利用者)/g;
// 「10代の女性」のような年代は許容し、「16歳」「（16）」のような正確な年齢を検出する
const EXACT_AGE_RE = /\d{1,3}歳|[(（]\d{1,3}[)）]/g;

/** 年齢表記の直前・直後から、被告人・被疑者の年齢かどうかを判断する */
function isOffenderAge(text: string, index: number, length: number): boolean {
  const before = text.slice(Math.max(0, index - 6), index);
  const after = text.slice(index + length, index + length + 6);
  // 「被告（45）」「男（45）」「容疑者（45）」
  if (/(被告人?|容疑者|受刑者|(?<!少)男|男性)$/.test(before)) return true;
  // 「45歳の男」「45歳の被告」「45歳の会社員の男」
  if (/^の(.{0,4}の)?(男|被告|容疑者)/.test(after)) return true;
  return false;
}

export interface PiiOptions {
  isJuvenile: boolean;
  /** 性犯罪の罪状を含むか（被害者を特定できる情報をより厳しく検出する） */
  isSexCrime?: boolean;
}

export function detectPii(fields: Record<string, string | undefined | null>, opts: boolean | PiiOptions): Flag[] {
  const { isJuvenile, isSexCrime = false } = typeof opts === "boolean" ? { isJuvenile: opts } : opts;
  const flags: Flag[] = [];
  for (const [field, text] of Object.entries(fields)) {
    if (!text) continue;
    scanNames(field, text, flags);
    for (const m of text.matchAll(PHONE_RE)) flags.push({ kind: "phone", field, match: m[0] });
    for (const m of text.matchAll(STREET_RE)) flags.push({ kind: "street_address", field, match: m[0] });
    if (isSexCrime) {
      // 性犯罪では被害者の正確な年齢を検出する。「被告（45）」「45歳の男」のように被告人・被疑者の年齢と分かるものは除く
      for (const m of text.matchAll(EXACT_AGE_RE)) {
        if (isOffenderAge(text, m.index ?? 0, m[0].length)) continue;
        flags.push({ kind: "victim_age", field, match: m[0] });
      }
      for (const m of text.matchAll(VICTIM_RELATION_RE)) flags.push({ kind: "victim_relation", field, match: m[0] });
    }
    if (isJuvenile || isSexCrime) {
      for (const m of text.matchAll(SCHOOL_RE)) flags.push({ kind: "school", field, match: m[0] });
    }
  }
  return flags;
}
