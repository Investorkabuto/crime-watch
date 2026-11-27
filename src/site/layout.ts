// 公開サイトの共通レイアウト（モダン・ミニマル × Bento Grid、OS ダークモード自動追従）
import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";

export type NavKey = "home" | "cases" | "themes" | "laws" | "prefectures" | "stats" | "none";

export interface LayoutOptions {
  title: string;
  description?: string;
  activeNav?: NavKey;
  canonicalPath?: string;
  origin?: string;
  ogImagePath?: string;
  ogType?: "website" | "article";
  jsonLd?: Record<string, unknown>;
  searchQuery?: string;
  noindex?: boolean;
  body: HtmlEscapedString | Promise<HtmlEscapedString>;
}

const SITE_CSS = `
:root {
  --bg: #f8f9fb;
  --surface: #ffffff;
  --surface-subtle: #f1f4f8;
  --header-bg: rgba(255, 255, 255, 0.82);
  --text: #0f172a;
  --text-sub: #334155;
  --muted: #64748b;
  --line: #e5e7eb;
  --line-strong: #cbd5e1;
  --accent: #3b5bdb;
  --accent-soft: #eef2ff;
  --accent-border: #c7d2fe;
  --track: #edf0f5;
  --dist-band: rgba(59, 91, 219, 0.16);
  --shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.04);
  --shadow-card: 0 2px 10px rgba(15, 23, 42, 0.035), 0 1px 2px rgba(15, 23, 42, 0.04);
  --radius-card: 16px;
  --radius-pill: 999px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0b0f17;
    --surface: #131926;
    --surface-subtle: #1a2234;
    --header-bg: rgba(19, 25, 38, 0.82);
    --text: #f1f5f9;
    --text-sub: #cbd5e1;
    --muted: #94a3b8;
    --line: #232c3d;
    --line-strong: #334155;
    --accent: #748ffc;
    --accent-soft: rgba(116, 143, 252, 0.14);
    --accent-border: rgba(116, 143, 252, 0.34);
    --track: #1f293b;
    --dist-band: rgba(116, 143, 252, 0.24);
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.25);
    --shadow-card: 0 4px 16px rgba(0, 0, 0, 0.24);
  }
}
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 15px/1.65 system-ui, -apple-system, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif;
  font-feature-settings: "palt" 1;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.num { font-variant-numeric: tabular-nums; }

/* Sticky frosted-glass header */
.site-header {
  position: sticky; top: 0; z-index: 40;
  background: var(--header-bg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--line);
}
.header-inner {
  max-width: 1120px; margin: 0 auto; padding: 10px 16px;
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
}
.brand {
  font-size: 18px; font-weight: 800; letter-spacing: -0.025em;
  color: var(--text); text-decoration: none; white-space: nowrap;
  display: inline-flex; align-items: center; gap: 8px;
}
.brand:hover { text-decoration: none; opacity: 0.88; }
.brand-dot {
  width: 8px; height: 8px; border-radius: 50%; background: var(--accent); display: inline-block;
}
.nav {
  display: flex; align-items: center; gap: 4px; overflow-x: auto;
  scrollbar-width: none; -ms-overflow-style: none;
}
.nav::-webkit-scrollbar { display: none; }
.nav a {
  padding: 6px 11px; border-radius: 10px; font-size: 14px; font-weight: 500;
  color: var(--muted); white-space: nowrap; transition: background 0.15s, color 0.15s;
}
.nav a:hover { background: var(--surface-subtle); color: var(--text); text-decoration: none; }
.nav a.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.header-search {
  margin-left: auto; display: flex; align-items: center;
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-pill);
  padding: 3px 6px 3px 12px; min-width: 180px;
}
.header-search input {
  border: 0; background: transparent; color: var(--text); font: 13px/1.4 inherit;
  width: 100%; min-width: 100px; outline: none;
}
.header-search button {
  border: 0; background: transparent; color: var(--muted); cursor: pointer;
  padding: 4px 6px; font-size: 13px; border-radius: var(--radius-pill);
}
.header-search button:hover { color: var(--text); }

/* AI notice strip */
.ai-notice {
  max-width: 1120px; margin: 12px auto 0; padding: 0 16px;
}
.ai-notice-inner {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 8px 14px; border-radius: 12px;
  background: var(--surface-subtle); border: 1px solid var(--line);
  font-size: 12.5px; color: var(--muted);
}
.ai-notice-inner a { white-space: nowrap; font-weight: 600; font-size: 12px; }
.ai-notice-text { overflow: hidden; text-overflow: ellipsis; }

/* Main container */
.container { max-width: 1120px; margin: 0 auto; padding: 18px 16px 48px; }

/* Bento cards & grids */
.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  padding: 20px;
  box-shadow: var(--shadow-card);
}
.card + .card { margin-top: 16px; }
.card-title {
  margin: 0 0 14px; font-size: 15px; font-weight: 700; letter-spacing: -0.01em;
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
}
.bento-kpi { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
.kpi-card {
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-card);
  padding: 18px 20px; box-shadow: var(--shadow-card);
}
.kpi-label { font-size: 12.5px; color: var(--muted); font-weight: 500; margin-bottom: 4px; }
.kpi-value { font-size: 30px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.15; }
.kpi-unit { font-size: 14px; font-weight: 600; color: var(--muted); margin-left: 3px; }
.kpi-sub { font-size: 12px; color: var(--muted); margin-top: 4px; }

.bento-2col { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr); gap: 16px; margin-top: 16px; align-items: start; }
.bento-equal { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 16px; align-items: start; }
.bento-3col { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }

/* Tags & pills */
.pills { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.pill {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 10px; border-radius: var(--radius-pill);
  font-size: 12.5px; font-weight: 500; line-height: 1.3;
  background: var(--surface-subtle); color: var(--text-sub); border: 1px solid var(--line);
  text-decoration: none;
}
.pill:hover { border-color: var(--accent-border); color: var(--accent); text-decoration: none; }
.pill-accent {
  background: var(--accent-soft); color: var(--accent); border-color: var(--accent-border); font-weight: 600;
}
.pill-count {
  font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums;
  background: var(--surface); padding: 1px 6px; border-radius: var(--radius-pill);
}

/* Stage / presumption badge */
.presumption-box {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: var(--radius-pill);
  background: var(--surface-subtle); border: 1px solid var(--line-strong);
  font-size: 12.5px; color: var(--text-sub); font-weight: 500;
}
.note-box {
  padding: 12px 14px; border-radius: 12px; background: var(--surface-subtle);
  border: 1px solid var(--line); font-size: 13px; color: var(--muted);
}

/* Progress stepper */
.stepper {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 4px;
  position: relative; padding: 8px 0 4px; overflow-x: auto;
}
.step {
  flex: 1; min-width: 52px; display: flex; flex-direction: column; align-items: center;
  position: relative; text-align: center;
}
.step::before {
  content: ""; position: absolute; top: 7px; left: -50%; right: 50%; height: 2px; background: var(--line);
}
.step:first-child::before { display: none; }
.step.done::before, .step.current::before { background: var(--accent); }
.step-dot {
  width: 14px; height: 14px; border-radius: 50%; background: var(--surface);
  border: 2px solid var(--line-strong); position: relative; z-index: 1;
}
.step.done .step-dot { background: var(--accent); border-color: var(--accent); }
.step.current .step-dot {
  background: var(--accent); border-color: var(--accent);
  box-shadow: 0 0 0 4px var(--accent-soft);
}
.step-label { margin-top: 6px; font-size: 11.5px; color: var(--muted); white-space: nowrap; }
.step.done .step-label { color: var(--text-sub); }
.step.current .step-label { color: var(--text); font-weight: 700; }

/* Feed / list rows */
.feed { list-style: none; margin: 0; padding: 0; }
.feed-item {
  padding: 12px 0; border-bottom: 1px solid var(--line);
  display: flex; flex-direction: column; gap: 4px;
}
.feed-item:first-child { padding-top: 2px; }
.feed-item:last-child { border-bottom: 0; padding-bottom: 2px; }
.feed-title { font-size: 15px; font-weight: 600; color: var(--text); line-height: 1.45; }
.feed-title:hover { color: var(--accent); text-decoration: none; }
.feed-meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 12.5px; color: var(--muted); }

/* Timeline */
.timeline { list-style: none; margin: 0; padding: 0 0 0 18px; border-left: 2px solid var(--line); }
.tl-item { position: relative; padding: 0 0 16px 12px; }
.tl-item:last-child { padding-bottom: 0; }
.tl-item::before {
  content: ""; position: absolute; left: -24px; top: 6px; width: 10px; height: 10px;
  border-radius: 50%; background: var(--accent); border: 2px solid var(--surface);
}
.tl-item.is-judgment::before { background: var(--text); }
.tl-date { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.tl-stage { font-weight: 700; font-size: 14px; color: var(--text); margin-right: 6px; }
.tl-body { font-size: 13.5px; color: var(--text-sub); margin: 4px 0; }

/* Tables */
.table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
th { font-size: 12px; font-weight: 600; color: var(--muted); white-space: nowrap; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
tbody tr:hover { background: var(--surface-subtle); }

/* Key-value definition lists */
dl.kv { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 14px; margin: 0; font-size: 13.5px; }
dl.kv dt { color: var(--muted); font-weight: 500; }
dl.kv dd { margin: 0; color: var(--text); }

/* Forms & buttons */
.filter-form { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.input, select.input, textarea.input {
  font: 14px/1.4 inherit; padding: 8px 11px; border: 1px solid var(--line);
  border-radius: 10px; background: var(--bg); color: var(--text); max-width: 100%;
}
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  font: 13.5px/1.3 inherit; font-weight: 600; padding: 8px 14px;
  border-radius: 10px; border: 1px solid var(--line); background: var(--surface);
  color: var(--text); cursor: pointer; text-decoration: none;
}
.btn:hover { background: var(--surface-subtle); text-decoration: none; }
.btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn-primary:hover { opacity: 0.92; background: var(--accent); color: #fff; }

/* Pagination */
.pager { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 18px; }

/* Headings & misc */
.page-h1 { margin: 0 0 8px; font-size: 24px; font-weight: 800; letter-spacing: -0.025em; line-height: 1.35; }
.page-lead { margin: 0 0 16px; color: var(--muted); font-size: 14px; }
.muted { color: var(--muted); }
.small { font-size: 12.5px; }
.mt-8 { margin-top: 8px; }
.mt-12 { margin-top: 12px; }
.mt-16 { margin-top: 16px; }
.mb-0 { margin-bottom: 0; }
.divider { border: 0; border-top: 1px solid var(--line); margin: 16px 0; }

/* Footer */
.site-footer {
  border-top: 1px solid var(--line); background: var(--surface);
  padding: 24px 16px; margin-top: 24px;
}
.footer-inner {
  max-width: 1120px; margin: 0 auto; display: flex; flex-wrap: wrap;
  justify-content: space-between; align-items: center; gap: 12px;
  font-size: 13px; color: var(--muted);
}
.footer-links { display: flex; flex-wrap: wrap; gap: 14px; }
.footer-links a { color: var(--muted); }
.footer-links a:hover { color: var(--text); }

/* Responsive (mobile-first 360px+) */
@media (max-width: 820px) {
  .bento-2col, .bento-equal { grid-template-columns: 1fr; }
  .bento-3col { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  .header-inner { gap: 8px; padding: 8px 12px; }
  .header-search { width: 100%; margin-left: 0; order: 3; }
  .ai-notice { padding: 0 12px; }
  .ai-notice-text { white-space: nowrap; }
  .container { padding: 14px 12px 36px; }
  .card { padding: 16px; }
  .bento-kpi { grid-template-columns: 1fr; gap: 8px; }
  .kpi-card { display: flex; justify-content: space-between; align-items: baseline; padding: 14px 16px; }
  .kpi-value { font-size: 24px; }
  .bento-3col { grid-template-columns: 1fr; }
  .page-h1 { font-size: 20px; }
  .hide-sm { display: none; }
}
`;

export function renderLayout(opts: LayoutOptions) {
  const origin = opts.origin ?? "";
  const canonicalUrl = opts.canonicalPath ? `${origin}${opts.canonicalPath}` : undefined;
  const ogImageUrl = `${origin}${opts.ogImagePath ?? "/og/default.svg"}`;
  const desc = opts.description ?? "日本国内の犯罪報道と判決（量刑・裁判所・担当裁判官）を事実のみに基づいて記録・公開するデータアーカイブ。";
  const nav = opts.activeNav ?? "none";

  const navLink = (key: NavKey, href: string, label: string) =>
    html`<a href="${href}" class="${nav === key ? "active" : ""}">${label}</a>`;

  return html`<!doctype html>
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${opts.title}</title>
        <meta name="description" content="${desc}" />
        ${opts.noindex ? html`<meta name="robots" content="noindex, nofollow" />` : ""}
        ${canonicalUrl ? html`<link rel="canonical" href="${canonicalUrl}" />` : ""}
        <meta property="og:site_name" content="Crime Watch" />
        <meta property="og:title" content="${opts.title}" />
        <meta property="og:description" content="${desc}" />
        <meta property="og:type" content="${opts.ogType ?? "website"}" />
        ${canonicalUrl ? html`<meta property="og:url" content="${canonicalUrl}" />` : ""}
        <meta property="og:image" content="${ogImageUrl}" />
        <meta name="twitter:card" content="summary_large_image" />
        <link rel="alternate" type="application/rss+xml" title="Crime Watch RSS" href="/feed.xml" />
        ${opts.jsonLd
          ? html`<script type="application/ld+json">
              ${raw(JSON.stringify(opts.jsonLd).replace(/</g, "\\u003c"))}
            </script>`
          : ""}
        <style>
          ${raw(SITE_CSS)}
        </style>
      </head>
      <body>
        <header class="site-header">
          <div class="header-inner">
            <a class="brand" href="/"><span class="brand-dot" aria-hidden="true"></span>Crime Watch</a>
            <nav class="nav" aria-label="メインナビゲーション">
              ${navLink("cases", "/cases", "事件")}
              ${navLink("themes", "/themes", "テーマ")}
              ${navLink("laws", "/laws", "法律")}
              ${navLink("prefectures", "/prefectures", "都道府県")}
              ${navLink("stats", "/stats", "統計")}
            </nav>
            <form class="header-search" action="/cases" method="get" role="search">
              <input
                type="search"
                name="q"
                value="${opts.searchQuery ?? ""}"
                placeholder="事件・罪状を検索"
                aria-label="事件を検索"
              />
              <button type="submit" aria-label="検索">検索</button>
            </form>
          </div>
        </header>
        <div class="ai-notice">
          <div class="ai-notice-inner">
            <span class="ai-notice-text"
              >AI が報道から自動で収集・分類した情報です。誤りを含む場合があります。出典の記事をご確認ください。</span
            >
            <a href="/contact">訂正を依頼</a>
          </div>
        </div>
        <main class="container">${opts.body}</main>
        <footer class="site-footer">
          <div class="footer-inner">
            <div>Crime Watch — 報道・判決で明らかになった事実のみを記録します</div>
            <div class="footer-links">
              <a href="/about">このサイトについて</a>
              <a href="/about/metrics">この数字について</a>
              <a href="/contact">削除・訂正の依頼</a>
              <a href="/feed.xml">RSS</a>
            </div>
          </div>
        </footer>
      </body>
    </html>`;
}
