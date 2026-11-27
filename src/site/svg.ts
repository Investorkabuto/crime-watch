// サーバー側で生成する SVG（量刑バー、ミニ量刑バー、月別推移グラフ、固定 OGP 画像）
// 評価を表す色（赤＝悪い、緑＝良い等）は使わず、単色のアクセントとニュートラルグレーだけで構成する。
import { raw } from "hono/html";
import { formatMonths } from "../normalize";

function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface SentencingBarInput {
  sentenceType: string;
  termMonths: number | null;
  suspendedMonths: number | null;
  demandType: string | null;
  demandMonths: number | null;
  statMinMonths: number | null;
  statMaxMonths: number | null;
  statVerified?: number | null;
  /** 同種判決の分布（n >= 20 のときだけ背景帯を重ねる） */
  dist?: {
    n: number;
    p25_months: number | null;
    median_months: number | null;
    p75_months: number | null;
  } | null;
}

const CUSTODIAL = new Set(["拘禁刑", "懲役", "禁錮"]);

/**
 * 判決 1 件ごとの量刑バー SVG（要件 F7 / 設計書 §4.2.1）
 * 死刑・無期・罰金のみ・無罪・不定期刑など有期刑以外は null を返す（文字表示のみ）。
 */
export function renderSentencingBar(input: SentencingBarInput) {
  if (!CUSTODIAL.has(input.sentenceType) || input.termMonths == null) return null;
  const min = input.statMinMonths;
  const max = input.statMaxMonths;
  if (min == null || max == null || max <= min) return null;

  const W = 520;
  const H = 98;
  const padL = 24;
  const padR = 24;
  const trackY = 48;
  const trackW = W - padL - padR;

  const clampRatio = (m: number) => Math.max(0, Math.min(1, (m - min) / (max - min)));
  const xOf = (m: number) => Math.round((padL + clampRatio(m) * trackW) * 10) / 10;

  const sentX = xOf(input.termMonths);
  const exceedsMax = input.termMonths > max;
  const belowMin = input.termMonths < min;
  const isSuspended = input.suspendedMonths != null;

  const hasDemand = input.demandMonths != null && input.demandType != null && CUSTODIAL.has(input.demandType);
  const demX = hasDemand ? xOf(input.demandMonths!) : null;

  // 同種判決の分布（20 件以上のときだけ表示）
  let distMarkup = "";
  if (input.dist && input.dist.n >= 20 && input.dist.p25_months != null && input.dist.p75_months != null) {
    const x25 = xOf(input.dist.p25_months);
    const x75 = xOf(input.dist.p75_months);
    const w = Math.max(2, x75 - x25);
    distMarkup += `<rect x="${x25}" y="${trackY - 7}" width="${w}" height="14" rx="7" fill="var(--dist-band)" />`;
    if (input.dist.median_months != null) {
      const xm = xOf(input.dist.median_months);
      distMarkup += `<line x1="${xm}" y1="${trackY - 9}" x2="${xm}" y2="${trackY + 9}" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="2 2" />`;
    }
  }

  // 求刑（ニュートラルグレーの三角 ▲）
  let demandMarkup = "";
  if (demX != null) {
    const labelAnchor = demX > W - 70 ? "end" : demX < 70 ? "start" : "middle";
    // 判決と近すぎる場合は上段・下段でずらす
    const demLabelY = Math.abs(demX - sentX) < 52 ? 15 : 22;
    demandMarkup = `
      <polygon points="${demX},${trackY - 8} ${demX - 6},${trackY + 3} ${demX + 6},${trackY + 3}" fill="var(--muted)" />
      <text x="${demX}" y="${demLabelY}" text-anchor="${labelAnchor}" font-size="11" fill="var(--muted)">求刑 ${escXml(formatMonths(input.demandMonths) ?? "")}</text>
    `;
  }

  // 判決（実刑: 塗りつぶし丸●、執行猶予: 白抜き丸○）
  const sentAnchor = sentX > W - 70 ? "end" : sentX < 70 ? "start" : "middle";
  const sentFill = isSuspended ? "var(--surface)" : "var(--accent)";
  const sentLabel = `判決 ${formatMonths(input.termMonths) ?? ""}`;

  const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="法定刑 ${escXml(formatMonths(min) ?? "")}から${escXml(formatMonths(max) ?? "")}の中で${escXml(sentLabel)}" style="display:block;max-width:560px;height:auto;overflow:visible">
    <rect x="${padL}" y="${trackY - 7}" width="${trackW}" height="14" rx="7" fill="var(--track)" stroke="var(--line)" stroke-width="1" />
    ${distMarkup}
    ${demandMarkup}
    <circle cx="${sentX}" cy="${trackY}" r="7" fill="${sentFill}" stroke="var(--accent)" stroke-width="2.5" />
    <text x="${sentX}" y="${trackY + 26}" text-anchor="${sentAnchor}" font-size="12" font-weight="600" fill="var(--text)">${escXml(sentLabel)}</text>
    <text x="${padL}" y="${trackY + 42}" text-anchor="start" font-size="11" fill="var(--muted)">${escXml(formatMonths(min) ?? "")}</text>
    <text x="${W - padR}" y="${trackY + 42}" text-anchor="end" font-size="11" fill="var(--muted)">${escXml(formatMonths(max) ?? "")}</text>
  </svg>`;

  const notes: string[] = [];
  if (exceedsMax) notes.push("法定刑の上限を超えています（併合罪加重などの可能性）");
  if (belowMin) notes.push("法定刑の下限を下回っています（未遂減軽・酌量減軽などの可能性）");
  if (input.dist && input.dist.n >= 20 && input.dist.median_months != null) {
    notes.push(`薄い帯は同種判決の 25〜75%（中央値 ${formatMonths(Math.round(input.dist.median_months))}・n=${input.dist.n}）`);
  }
  if (input.statVerified === 0) notes.push("法定刑は確認中");

  return {
    svg: raw(svg),
    notes,
  };
}

/** トップの「今日の判決」カード用ミニ量刑バー */
export function renderMiniSentencingBar(positionInRange: number | null, isSuspended: boolean) {
  if (positionInRange == null || !Number.isFinite(positionInRange)) return null;
  const clamped = Math.max(0, Math.min(1, positionInRange));
  const x = Math.round((8 + clamped * 144) * 10) / 10;
  const fill = isSuspended ? "var(--surface)" : "var(--accent)";
  return raw(
    `<svg viewBox="0 0 160 18" width="100%" height="18" aria-hidden="true" style="display:block;max-width:180px">` +
      `<rect x="4" y="6" width="152" height="6" rx="3" fill="var(--track)" />` +
      `<rect x="4" y="6" width="${Math.max(4, x - 4)}" height="6" rx="3" fill="var(--accent-soft)" />` +
      `<circle cx="${x}" cy="9" r="4.5" fill="${fill}" stroke="var(--accent)" stroke-width="2" />` +
      `</svg>`,
  );
}

/** 月別件数の棒グラフ SVG（テーマ別・法律別ページ用） */
export function renderMonthlyBarChart(series: { month: string; cases: number }[]) {
  if (series.length === 0) return null;
  const W = 560;
  const H = 140;
  const padL = 28;
  const padR = 12;
  const padT = 16;
  const padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxVal = Math.max(1, ...series.map((s) => s.cases));
  const step = plotW / series.length;
  const barW = Math.max(6, Math.min(32, step * 0.62));

  const bars = series
    .map((s, i) => {
      const h = Math.round((s.cases / maxVal) * plotH);
      const x = Math.round((padL + i * step + (step - barW) / 2) * 10) / 10;
      const y = padT + plotH - h;
      const label = s.month.slice(5).replace(/^0/, "") + "月";
      const showLabel = series.length <= 12 || i % Math.ceil(series.length / 8) === 0 || i === series.length - 1;
      return (
        `<rect x="${x}" y="${y}" width="${barW}" height="${Math.max(2, h)}" rx="4" fill="var(--accent)" opacity="0.85">` +
        `<title>${escXml(s.month)}: ${s.cases}件</title></rect>` +
        (s.cases > 0 && series.length <= 12
          ? `<text x="${x + barW / 2}" y="${Math.max(11, y - 4)}" text-anchor="middle" font-size="10" fill="var(--muted)">${s.cases}</text>`
          : "") +
        (showLabel
          ? `<text x="${x + barW / 2}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--muted)">${escXml(label)}</text>`
          : "")
      );
    })
    .join("");

  return raw(
    `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="月ごとの件数推移" style="display:block;height:auto">` +
      `<line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="var(--line)" stroke-width="1" />` +
      bars +
      `</svg>`,
  );
}

/** 固定 OGP 画像（SVG。テーマ別・デフォルト用） */
export function renderOgSvg(title: string, subtitle: string): string {
  const safeTitle = escXml(title.slice(0, 36));
  const safeSub = escXml(subtitle.slice(0, 60));
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#F8F9FB"/>
  <rect x="56" y="56" width="1088" height="518" rx="28" fill="#FFFFFF" stroke="#E5E7EB" stroke-width="2"/>
  <rect x="104" y="108" width="12" height="44" rx="6" fill="#3B5BDB"/>
  <text x="132" y="142" font-family="system-ui, -apple-system, 'Hiragino Sans', 'Noto Sans JP', sans-serif" font-size="34" font-weight="700" fill="#0F172A">Crime Watch</text>
  <text x="104" y="290" font-family="system-ui, -apple-system, 'Hiragino Sans', 'Noto Sans JP', sans-serif" font-size="54" font-weight="700" fill="#0F172A">${safeTitle}</text>
  <text x="104" y="366" font-family="system-ui, -apple-system, 'Hiragino Sans', 'Noto Sans JP', sans-serif" font-size="28" fill="#475569">${safeSub}</text>
  <text x="104" y="516" font-family="system-ui, -apple-system, 'Hiragino Sans', 'Noto Sans JP', sans-serif" font-size="22" fill="#64748B">報道・判決で明らかになった事実を法律・テーマごとに記録</text>
</svg>`;
}
