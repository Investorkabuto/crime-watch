// 罪状 → 法律の自動判定（要件 F3）

export interface ClassifiedCharge {
  raw: string; // Muse から受け取った文字列
  text: string; // 区切り・正規化後の罪状
  lawCode: string | null; // null = 未分類
  modifier: string | null; // attempt | accessory | instigation
  matchedAlias: string | null;
}

export type AliasMap = Map<string, string>;

const MODIFIERS: [RegExp, string][] = [
  [/未遂/g, "attempt"],
  [/(ほう助|幇助)/g, "accessory"],
  [/教唆/g, "instigation"],
];

// 辞書より先に評価する組み合わせ規則（すべてのキーワードを含むときにその法律）
const COMBINATION_RULES: { all: string[]; law: string }[] = [
  { all: ["覚醒剤", "営利"], law: "stimulants_profit" },
];

/** 正規化: 全角半角の統一、「覚せい剤」の統一、括弧の展開、定型句の除去 */
export function normalizeCharge(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[\s]/g, "")
    .replace(/覚せい剤/g, "覚醒剤")
    .replace(/[()（）「」『』［］\[\]【】]/g, "")
    .replace(/(の疑い|疑い|容疑|被告事件|事件)$/g, "")
    .replace(/違反/g, "")
    .replace(/罪$/g, "")
    .replace(/(共謀|共同正犯)/g, "");
}

const LAW_NAMES_WITH_OYOBI = ["麻薬及び向精神薬取締法", "出入国管理及び難民認定法", "私的独占の禁止及び公正取引の確保に関する法律", "銃砲刀剣類所持等取締法"];

/** 括弧の外にある区切り（・、,，/／）で分割する */
export function splitCharges(raw: string): string[] {
  const s = raw.normalize("NFKC");
  const parts: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of s) {
    if ("(（「『[【".includes(ch)) depth++;
    if (")）」』]】".includes(ch)) depth = Math.max(0, depth - 1);
    if (depth === 0 && "・、,，/／".includes(ch)) {
      if (buf.trim()) parts.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) parts.push(buf.trim());
  // 「及び」「および」でも分ける。ただし「麻薬及び向精神薬取締法」「出入国管理及び難民認定法」のように
  // 法律名の一部になっている「及び」では分けない
  return parts.flatMap((p) => (LAW_NAMES_WITH_OYOBI.some((n) => p.includes(n)) ? [p] : p.split(/及び|および/))).filter((p) => p.length > 0);
}

function extractModifier(text: string): { text: string; modifier: string | null } {
  let modifier: string | null = null;
  let t = text;
  for (const [re, mod] of MODIFIERS) {
    if (re.test(t)) {
      modifier = modifier ?? mod;
      t = t.replace(re, "");
    }
    re.lastIndex = 0;
  }
  return { text: t, modifier };
}

function lookup(text: string, aliases: AliasMap): { law: string; alias: string } | null {
  for (const rule of COMBINATION_RULES) {
    if (rule.all.every((k) => text.includes(k))) return { law: rule.law, alias: rule.all.join("+") };
  }
  const exact = aliases.get(text);
  if (exact) return { law: exact, alias: text };
  // 罪状に含まれる最も長い言い方を採用
  let best: { law: string; alias: string } | null = null;
  for (const [alias, law] of aliases) {
    if (text.includes(alias) && (!best || alias.length > best.alias.length)) best = { law, alias };
  }
  return best;
}

/**
 * 「道路交通法違反（無免許運転、酒気帯び運転）」のように括弧の中に罪状が並ぶ場合、
 * 中身がそれぞれ単独で判定できるなら中身を罪状として扱う。
 * 「覚醒剤取締法違反（使用・所持）」のように中身だけでは判定できない場合は全体で判定する。
 */
function expandParenthesized(part: string, aliases: AliasMap): string[] {
  const m = part.normalize("NFKC").match(/^(.*?)[(（](.+)[)）]$/);
  if (!m || !m[2]) return [part];
  const inner = splitCharges(m[2]);
  const allHit = inner.every((p) => lookup(extractModifier(normalizeCharge(p)).text, aliases) !== null);
  return allHit ? inner : [part];
}

/** 罪状の配列を分類する */
export function classifyCharges(charges: string[], aliases: AliasMap): ClassifiedCharge[] {
  const out: ClassifiedCharge[] = [];
  for (const raw of charges) {
    const parts = splitCharges(raw).flatMap((p) => expandParenthesized(p, aliases));
    let prevNormalized: string | null = null;
    for (const part of parts) {
      const normalized = normalizeCharge(part);
      const { text, modifier } = extractModifier(normalized);
      let hit = lookup(text, aliases);
      let finalText = text;
      // 「死体損壊・遺棄」のように前の罪状と頭が共通する省略形を補う
      if (!hit && prevNormalized && text.length < prevNormalized.length) {
        const candidate = prevNormalized.slice(0, prevNormalized.length - text.length) + text;
        const h2 = lookup(candidate, aliases);
        if (h2) {
          hit = h2;
          finalText = candidate;
        }
      }
      out.push({
        raw,
        text: finalText,
        lawCode: hit?.law ?? null,
        modifier,
        matchedAlias: hit?.alias ?? null,
      });
      prevNormalized = finalText;
    }
  }
  return out;
}
