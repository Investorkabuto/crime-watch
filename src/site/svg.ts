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

/** 直近 1 年の月別「犯罪（報道）件数＋判決件数」積み上げ棒グラフ SVG（トップページ用） */
export function renderStackedMonthlyBarChart(series: { month: string; cases: number; judgments: number }[]) {
  if (series.length === 0) return null;
  const W = 640;
  const H = 192;
  const padL = 32;
  const padR = 14;
  const padT = 22;
  const padB = 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxVal = Math.max(1, ...series.map((s) => s.cases + s.judgments));
  const step = plotW / series.length;
  const barW = Math.max(12, Math.min(34, step * 0.56));

  const gridLines = [0.25, 0.5, 0.75, 1]
    .map((ratio) => {
      const y = Math.round((padT + plotH * (1 - ratio)) * 10) / 10;
      const val = Math.round(maxVal * ratio);
      return (
        `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--line)" stroke-width="1" stroke-dasharray="3 3" />` +
        (ratio === 0.5 || ratio === 1
          ? `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="10" fill="var(--muted)">${val}</text>`
          : "")
      );
    })
    .join("");

  const bars = series
    .map((s, i) => {
      const total = s.cases + s.judgments;
      const x = Math.round((padL + i * step + (step - barW) / 2) * 10) / 10;
      const caseH = s.cases > 0 ? Math.max(2, Math.round((s.cases / maxVal) * plotH)) : 0;
      const judgH = s.judgments > 0 ? Math.max(2, Math.round((s.judgments / maxVal) * plotH)) : 0;
      const caseY = padT + plotH - caseH;
      const judgY = caseY - judgH;
      const label = s.month.slice(5).replace(/^0/, "") + "月";
      const topY = total > 0 ? judgY : padT + plotH;

      return (
        `<g>` +
        `<title>${escXml(s.month)} — 犯罪報道 ${s.cases}件 / 判決 ${s.judgments}件（計 ${total}件）</title>` +
        (caseH > 0
          ? `<rect x="${x}" y="${caseY}" width="${barW}" height="${caseH}" rx="${judgH > 0 ? 2 : 4}" fill="var(--accent)" opacity="0.88" />`
          : "") +
        (judgH > 0
          ? `<rect x="${x}" y="${judgY}" width="${barW}" height="${judgH}" rx="4" fill="#38bdf8" opacity="0.92" />`
          : "") +
        (total > 0
          ? `<text x="${x + barW / 2}" y="${Math.max(12, topY - 5)}" text-anchor="middle" font-size="10.5" font-weight="600" fill="var(--text-sub)">${total}</text>`
          : "") +
        `<text x="${x + barW / 2}" y="${H - 10}" text-anchor="middle" font-size="10.5" fill="var(--muted)">${escXml(label)}</text>` +
        `</g>`
      );
    })
    .join("");

  return raw(
    `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="直近1年の犯罪件数と判決件数の月別積み上げ棒グラフ" style="display:block;height:auto">` +
      gridLines +
      `<line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="var(--line-strong)" stroke-width="1" />` +
      bars +
      `</svg>`,
  );
}

/** 法律別の量刑分布グラフ SVG（法定刑の範囲内に各判決の刑期をドット分布＋四分位帯で表示） */
export function renderSentencingDistributionChart(input: {
  statMinMonths: number | null;
  statMaxMonths: number | null;
  points: { termMonths: number; isSuspended: boolean }[];
  medianMonths?: number | null;
  p25Months?: number | null;
  p75Months?: number | null;
}) {
  if (input.points.length === 0) return null;
  const terms = input.points.map((p) => p.termMonths);
  const dataMin = Math.min(...terms);
  const dataMax = Math.max(...terms);
  const minM = input.statMinMonths != null ? Math.min(input.statMinMonths, dataMin) : Math.max(0, dataMin - 6);
  const maxM = input.statMaxMonths != null ? Math.max(input.statMaxMonths, dataMax) : dataMax + 6;
  const span = Math.max(1, maxM - minM);

  const W = 600;
  const H = 136;
  const padL = 28;
  const padR = 28;
  const plotW = W - padL - padR;
  const axisY = 92;

  const xOf = (m: number) => Math.round((padL + Math.max(0, Math.min(1, (m - minM) / span)) * plotW) * 10) / 10;

  // 法定刑の範囲ハイライト
  let statBand = "";
  if (input.statMinMonths != null && input.statMaxMonths != null && input.statMaxMonths > input.statMinMonths) {
    const sx1 = xOf(input.statMinMonths);
    const sx2 = xOf(input.statMaxMonths);
    statBand = `<rect x="${sx1}" y="${axisY - 6}" width="${Math.max(4, sx2 - sx1)}" height="12" rx="6" fill="var(--track)" stroke="var(--line-strong)" stroke-width="1" />`;
  } else {
    statBand = `<rect x="${padL}" y="${axisY - 6}" width="${plotW}" height="12" rx="6" fill="var(--track)" stroke="var(--line)" stroke-width="1" />`;
  }

  // 四分位帯（25%〜75%）と中央値
  let iqrMarkup = "";
  if (input.p25Months != null && input.p75Months != null && input.points.length >= 4) {
    const x25 = xOf(input.p25Months);
    const x75 = xOf(input.p75Months);
    iqrMarkup += `<rect x="${x25}" y="${axisY - 8}" width="${Math.max(4, x75 - x25)}" height="16" rx="6" fill="var(--dist-band)" />`;
  }
  if (input.medianMonths != null && input.points.length >= 2) {
    const xm = xOf(input.medianMonths);
    iqrMarkup +=
      `<line x1="${xm}" y1="${axisY - 58}" x2="${xm}" y2="${axisY + 10}" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="3 3" opacity="0.8" />` +
      `<text x="${xm}" y="20" text-anchor="${xm > W - 80 ? "end" : xm < 80 ? "start" : "middle"}" font-size="11" font-weight="700" fill="var(--accent)">中央値 ${escXml(formatMonths(Math.round(input.medianMonths)) ?? "")}</text>`;
  }

  // 近い刑期のドットを縦に少しずつ積んで重なりを見える化（ビーズウォーム風）
  const sorted = [...input.points].sort((a, b) => a.termMonths - b.termMonths);
  const bucketCounts = new Map<number, number>();
  const dots = sorted
    .map((pt) => {
      const x = xOf(pt.termMonths);
      const bucket = Math.round(x / 10);
      const stackIdx = bucketCounts.get(bucket) ?? 0;
      bucketCounts.set(bucket, stackIdx + 1);
      const cy = Math.max(26, axisY - 16 - Math.min(stackIdx, 6) * 9);
      const fill = pt.isSuspended ? "var(--surface-solid)" : "var(--accent)";
      const stroke = pt.isSuspended ? "#38bdf8" : "var(--accent)";
      const label = `${formatMonths(pt.termMonths) ?? ""}（${pt.isSuspended ? "執行猶予" : "実刑"}）`;
      return `<circle cx="${x}" cy="${cy}" r="4.5" fill="${fill}" stroke="${stroke}" stroke-width="2"><title>${escXml(label)}</title></circle>`;
    })
    .join("");

  // 目盛りラベル（下限・中央・上限）
  const midM = Math.round(minM + span / 2);
  const ticks = [
    { x: padL, anchor: "start", text: formatMonths(Math.round(minM)) ?? "" },
    { x: Math.round((padL + plotW / 2) * 10) / 10, anchor: "middle", text: formatMonths(midM) ?? "" },
    { x: W - padR, anchor: "end", text: formatMonths(Math.round(maxM)) ?? "" },
  ]
    .map(
      (tk) =>
        `<text x="${tk.x}" y="${axisY + 28}" text-anchor="${tk.anchor}" font-size="11" fill="var(--muted)">${escXml(tk.text)}</text>`,
    )
    .join("");

  return raw(
    `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="法定刑の範囲内における量刑分布グラフ" style="display:block;height:auto">` +
      statBand +
      iqrMarkup +
      dots +
      ticks +
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
  <text x="132" y="142" font-family="system-ui, -apple-system, 'Hiragino Sans', 'Noto Sans JP', sans-serif" font-size="34" font-weight="700" fill="#0F172A">HANZAI Watch</text>
  <text x="104" y="290" font-family="system-ui, -apple-system, 'Hiragino Sans', 'Noto Sans JP', sans-serif" font-size="54" font-weight="700" fill="#0F172A">${safeTitle}</text>
  <text x="104" y="366" font-family="system-ui, -apple-system, 'Hiragino Sans', 'Noto Sans JP', sans-serif" font-size="28" fill="#475569">${safeSub}</text>
  <text x="104" y="516" font-family="system-ui, -apple-system, 'Hiragino Sans', 'Noto Sans JP', sans-serif" font-size="22" fill="#64748B">報道・判決で明らかになった事実を法律・テーマごとに記録</text>
</svg>`;
}
