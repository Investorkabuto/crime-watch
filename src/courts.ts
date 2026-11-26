// 裁判所名の正規化と、裁判所の種類・都道府県の判定

const ABBREVIATIONS: [RegExp, string][] = [
  [/最高裁(?!判所)/g, "最高裁判所"],
  [/高裁(?!判所)/g, "高等裁判所"],
  [/地裁(?!判所)/g, "地方裁判所"],
  [/家裁(?!判所)/g, "家庭裁判所"],
  [/簡裁(?!判所)/g, "簡易裁判所"],
];

export function normalizeCourtName(raw: string): string {
  let s = raw.normalize("NFKC").replace(/[\s　]/g, "");
  for (const [re, full] of ABBREVIATIONS) s = s.replace(re, full);
  return s;
}

export function courtLevel(name: string): string {
  if (name.includes("最高裁判所")) return "最高裁";
  if (name.includes("高等裁判所")) return "高裁";
  if (name.includes("地方裁判所")) return "地裁";
  if (name.includes("家庭裁判所")) return "家裁";
  if (name.includes("簡易裁判所")) return "簡裁";
  return "不明";
}

// 地方裁判所・家庭裁判所の本庁所在地 → 都道府県（支部名は本庁名に続くので先頭一致で判定できる）
const COURT_SEATS: [string, string][] = [
  ["札幌", "北海道"], ["函館", "北海道"], ["旭川", "北海道"], ["釧路", "北海道"],
  ["青森", "青森県"], ["盛岡", "岩手県"], ["仙台", "宮城県"], ["秋田", "秋田県"],
  ["山形", "山形県"], ["福島", "福島県"], ["水戸", "茨城県"], ["宇都宮", "栃木県"],
  ["前橋", "群馬県"], ["さいたま", "埼玉県"], ["千葉", "千葉県"], ["東京", "東京都"],
  ["横浜", "神奈川県"], ["新潟", "新潟県"], ["富山", "富山県"], ["金沢", "石川県"],
  ["福井", "福井県"], ["甲府", "山梨県"], ["長野", "長野県"], ["岐阜", "岐阜県"],
  ["静岡", "静岡県"], ["名古屋", "愛知県"], ["津", "三重県"], ["大津", "滋賀県"],
  ["京都", "京都府"], ["大阪", "大阪府"], ["神戸", "兵庫県"], ["奈良", "奈良県"],
  ["和歌山", "和歌山県"], ["鳥取", "鳥取県"], ["松江", "島根県"], ["岡山", "岡山県"],
  ["広島", "広島県"], ["山口", "山口県"], ["徳島", "徳島県"], ["高松", "香川県"],
  ["松山", "愛媛県"], ["高知", "高知県"], ["福岡", "福岡県"], ["佐賀", "佐賀県"],
  ["長崎", "長崎県"], ["熊本", "熊本県"], ["大分", "大分県"], ["宮崎", "宮崎県"],
  ["鹿児島", "鹿児島県"], ["那覇", "沖縄県"],
];

/** 地裁・家裁の名前から都道府県を判定する。高裁・最高裁・簡裁は管轄が都道府県と一致しないため null */
export function courtPrefecture(name: string): string | null {
  const level = courtLevel(name);
  if (level !== "地裁" && level !== "家裁") return null;
  // 長い名前から先に照合（「和歌山」と「山口」などの取り違えを防ぐため先頭一致）
  const seats = [...COURT_SEATS].sort((a, b) => b[0].length - a[0].length);
  for (const [seat, pref] of seats) {
    if (name.startsWith(seat + "地方裁判所") || name.startsWith(seat + "家庭裁判所")) return pref;
  }
  return null;
}
