// 捜査機関・検察庁の名前の正規化

export interface PoliceAgency {
  name: string;
  prefecture: string | null;
}

/** 「大阪府警」「京都府警察本部」「警視庁」「道警」→ 正式名と都道府県 */
export function normalizePoliceAgency(raw: string | undefined | null): PoliceAgency | null {
  if (!raw) return null;
  const s = raw.normalize("NFKC").replace(/[\s　]/g, "").replace(/本部$/, "");
  if (!s) return null;
  if (s === "警視庁") return { name: "警視庁", prefecture: "東京都" };
  if (/^(北海道警(察)?|道警)$/.test(s)) return { name: "北海道警察", prefecture: "北海道" };
  const m = s.match(/^(.+?)(県|府)警(察)?$/);
  if (m) return { name: `${m[1]}${m[2]}警察`, prefecture: `${m[1]}${m[2]}` };
  // 警察庁・管区警察局・麻薬取締部・海上保安部などは都道府県を持たない
  return { name: s, prefecture: null };
}

const PROSECUTOR_ABBR: [RegExp, string][] = [
  [/最高検(?!察)/g, "最高検察庁"],
  [/高検(?!察)/g, "高等検察庁"],
  [/地検(?!察)/g, "地方検察庁"],
  [/区検(?!察)/g, "区検察庁"],
];

/** 「大阪地検」「東京地検特捜部」→ 「大阪地方検察庁」「東京地方検察庁特捜部」 */
export function normalizeProsecutorOffice(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let s = raw.normalize("NFKC").replace(/[\s　]/g, "");
  for (const [re, full] of PROSECUTOR_ABBR) s = s.replace(re, full);
  return s || null;
}

/** 警察署名の正規化（「天満警察署」→「天満署」） */
export function normalizePoliceStation(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = raw.normalize("NFKC").replace(/[\s　]/g, "").replace(/警察署$/, "署");
  return s || null;
}
