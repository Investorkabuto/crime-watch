// 表記の正規化（要件 F2）

/** 「3年」「2年6月」「10か月」→ 月数。解釈できなければ null */
export function parseTermMonths(term: string | undefined | null): number | null {
  if (!term) return null;
  const s = term.normalize("NFKC").replace(/\s/g, "");
  const m = s.match(/^(?:(\d+)年)?(?:(\d+)(?:月|か月|カ月|ヶ月|ケ月))?$/);
  if (!m || (m[1] === undefined && m[2] === undefined)) return null;
  return Number(m[1] ?? 0) * 12 + Number(m[2] ?? 0);
}

/** 月数 → 「2年6月」 */
export function formatMonths(months: number | null | undefined): string | null {
  if (months == null) return null;
  const y = Math.floor(months / 12);
  const mo = months % 12;
  if (y && mo) return `${y}年${mo}月`;
  if (y) return `${y}年`;
  return `${mo}月`;
}

/** 人名（裁判官名）の正規化: 空白の除去、全角・半角の統一 */
export function normalizePersonName(name: string): string {
  return name.normalize("NFKC").replace(/[\s　]/g, "");
}

/** 年齢 → 年代 */
export function ageToGroup(age: number | null | undefined): string | null {
  if (age == null) return null;
  if (age < 10) return "10歳未満";
  if (age >= 100) return "100歳以上";
  return `${Math.floor(age / 10) * 10}代`;
}

/** 年齢 → 少年区分（犯行時ではなく報道時の年齢による目安） */
export function ageToJuvenileClass(age: number | null | undefined): string | null {
  if (age == null) return null;
  if (age < 18) return "juvenile";
  if (age < 20) return "specified_juvenile";
  return "adult";
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** 不正な % エンコードで例外を投げない decodeURIComponent（失敗時は null） */
export function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
