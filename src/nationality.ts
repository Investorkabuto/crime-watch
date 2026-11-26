// 国籍の表記の正規化（記事の表記 → 表示名と ISO 3166-1 alpha-2）

export interface Nationality {
  name: string; // 表示名
  code: string | null; // ISO 3166-1 alpha-2。対応表にない・国でないもの（朝鮮籍・無国籍など）は null
}

// [表示名, コード, 別の書き方...]
const TABLE: [string, string | null, ...string[]][] = [
  ["日本", "JP", "日本国"],
  ["ベトナム", "VN", "ベトナム社会主義共和国"],
  ["中国", "CN", "中華人民共和国"],
  ["韓国", "KR", "大韓民国"],
  ["北朝鮮", "KP", "朝鮮民主主義人民共和国"],
  ["台湾", "TW"],
  ["香港", "HK"],
  ["フィリピン", "PH"],
  ["ブラジル", "BR"],
  ["タイ", "TH"],
  ["インドネシア", "ID"],
  ["ネパール", "NP"],
  ["スリランカ", "LK"],
  ["ミャンマー", "MM"],
  ["カンボジア", "KH"],
  ["ラオス", "LA"],
  ["バングラデシュ", "BD"],
  ["パキスタン", "PK"],
  ["インド", "IN"],
  ["モンゴル", "MN"],
  ["マレーシア", "MY"],
  ["シンガポール", "SG"],
  ["ウズベキスタン", "UZ"],
  ["アフガニスタン", "AF"],
  ["イラン", "IR"],
  ["トルコ", "TR"],
  ["ペルー", "PE"],
  ["ボリビア", "BO"],
  ["コロンビア", "CO"],
  ["メキシコ", "MX"],
  ["アメリカ", "US", "米国", "アメリカ合衆国"],
  ["カナダ", "CA"],
  ["イギリス", "GB", "英国"],
  ["フランス", "FR"],
  ["ドイツ", "DE"],
  ["イタリア", "IT"],
  ["スペイン", "ES"],
  ["ロシア", "RU", "ロシア連邦"],
  ["ウクライナ", "UA"],
  ["オーストラリア", "AU"],
  ["ニュージーランド", "NZ"],
  ["ナイジェリア", "NG"],
  ["ガーナ", "GH"],
  ["カメルーン", "CM"],
  ["エジプト", "EG"],
  // 国ではない区分
  ["朝鮮", null, "朝鮮籍"],
  ["無国籍", null],
];

const LOOKUP = new Map<string, Nationality>();
for (const [name, code, ...aliases] of TABLE) {
  for (const k of [name, ...aliases]) LOOKUP.set(k, { name, code });
}

/** 「ベトナム国籍」「ベトナム人」「中華人民共和国」→ { name: "ベトナム", code: "VN" } など。空なら null */
export function normalizeNationality(raw: string | undefined | null): Nationality | null {
  if (!raw) return null;
  const s = raw.normalize("NFKC").replace(/[\s　]/g, "");
  if (!s || s === "不明") return null;
  // 「米国籍」「中国籍」は「籍」だけを、「ベトナム国籍」は「国籍」を、「ベトナム人」は「人」を外して照合する
  for (const c of [s, s.replace(/籍$/, ""), s.replace(/国籍$/, ""), s.replace(/人$/, "")]) {
    const hit = LOOKUP.get(c);
    if (hit) return hit;
  }
  // 対応表にない国は、記事の表記（「国籍」「人」を除いたもの）をそのまま表示名にする
  return { name: s.replace(/(国籍|人)$/, ""), code: null };
}

/** 在留資格の区分（記事に書かれる範囲。分からなければ送らない） */
export const RESIDENCE_STATUSES = [
  "永住者", "特別永住者", "定住者", "日本人の配偶者等", "永住者の配偶者等",
  "技能実習", "特定技能", "留学", "家族滞在", "技術・人文知識・国際業務", "短期滞在",
  "不法残留", "不法入国", "その他", "不明",
] as const;

/** 警察庁の区分に合わせた大分類。来日外国人＝定着居住者（永住者・特別永住者など）と在日米軍関係者以外 */
export function residenceGroup(status: string | null | undefined): "定着居住者" | "来日外国人" | null {
  if (!status || status === "不明" || status === "その他") return null;
  if (["永住者", "特別永住者", "永住者の配偶者等"].includes(status)) return "定着居住者";
  return "来日外国人";
}
