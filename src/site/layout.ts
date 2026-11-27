// 公開サイトの共通レイアウト（モダン・ミニマル × Bento Grid、OS ダークモード自動追従、統一スライドダウン検索ドロワー）
import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import { PREFECTURES } from "../schema";
import { THEMES } from "../themes";

export type NavKey = "home" | "cases" | "themes" | "laws" | "prefectures" | "stats" | "none";

const QUICK_PROGRESS_OPTIONS = [
  "捜査中",
  "公判中",
  "判決後（未確定）",
  "確定",
  "不起訴",
  "略式手続",
  "家裁送致",
] as const;

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
  drawerTitle?: string;
  drawerBody?: HtmlEscapedString | Promise<HtmlEscapedString>;
  activeFilterCount?: number;
  noindex?: boolean;
  body: HtmlEscapedString | Promise<HtmlEscapedString>;
}

const SITE_CSS = `
:root {
  --bg: #f6f8fc;
  --bg-glow: radial-gradient(ellipse 80% 45% at 50% -10%, rgba(59, 91, 219, 0.08), transparent 70%);
  --surface: rgba(255, 255, 255, 0.92);
  --surface-solid: #ffffff;
  --surface-subtle: #eef2f8;
  --header-bg: rgba(255, 255, 255, 0.78);
  --drawer-bg: rgba(255, 255, 255, 0.94);
  --backdrop: rgba(15, 23, 42, 0.36);
  --text: #0f172a;
  --text-sub: #334155;
  --muted: #64748b;
  --line: rgba(15, 23, 42, 0.09);
  --line-strong: rgba(15, 23, 42, 0.18);
  --accent: #3b5bdb;
  --accent-bright: #4c6ef5;
  --accent-soft: rgba(59, 91, 219, 0.1);
  --accent-border: rgba(59, 91, 219, 0.28);
  --accent-glow: 0 0 0 1px rgba(59, 91, 219, 0.24), 0 8px 24px -6px rgba(59, 91, 219, 0.18);
  --track: #e9edf5;
  --dist-band: rgba(59, 91, 219, 0.16);
  --shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.04);
  --shadow-card: 0 2px 12px rgba(15, 23, 42, 0.04), 0 1px 2px rgba(15, 23, 42, 0.04);
  --shadow-drawer: 0 24px 48px -12px rgba(15, 23, 42, 0.22);
  --radius-card: 18px;
  --radius-pill: 999px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #080c14;
    --bg-glow: radial-gradient(ellipse 80% 42% at 50% -12%, rgba(116, 143, 252, 0.14), transparent 72%);
    --surface: rgba(19, 25, 38, 0.86);
    --surface-solid: #131926;
    --surface-subtle: rgba(30, 41, 59, 0.65);
    --header-bg: rgba(11, 15, 23, 0.76);
    --drawer-bg: rgba(16, 22, 35, 0.94);
    --backdrop: rgba(2, 6, 14, 0.68);
    --text: #f1f5f9;
    --text-sub: #cbd5e1;
    --muted: #94a3b8;
    --line: rgba(148, 163, 184, 0.14);
    --line-strong: rgba(148, 163, 184, 0.28);
    --accent: #748ffc;
    --accent-bright: #91a7ff;
    --accent-soft: rgba(116, 143, 252, 0.15);
    --accent-border: rgba(116, 143, 252, 0.36);
    --accent-glow: 0 0 0 1px rgba(116, 143, 252, 0.36), 0 10px 28px -8px rgba(116, 143, 252, 0.28);
    --track: #1e293b;
    --dist-band: rgba(116, 143, 252, 0.24);
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
    --shadow-card: 0 4px 20px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.03);
    --shadow-drawer: 0 28px 64px -12px rgba(0, 0, 0, 0.7);
  }
}
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; touch-action: manipulation; }
body {
  margin: 0;
  min-height: 100dvh;
  touch-action: manipulation;
  background-color: var(--bg);
  background-image: var(--bg-glow);
  background-attachment: fixed;
  color: var(--text);
  font: 15px/1.65 system-ui, -apple-system, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif;
  font-feature-settings: "palt" 1;
}
body.search-open { overflow: hidden; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.num { font-variant-numeric: tabular-nums; }

/* Sticky frosted-glass header */
.site-header {
  position: sticky; top: 0; z-index: 40;
  background: var(--header-bg);
  backdrop-filter: blur(16px) saturate(160%);
  -webkit-backdrop-filter: blur(16px) saturate(160%);
  border-bottom: 1px solid var(--line);
}
.header-inner {
  max-width: 1120px; margin: 0 auto; padding: 10px 16px;
  display: flex; align-items: center; gap: 12px;
}
.brand {
  font-size: 17px; font-weight: 800; letter-spacing: -0.03em;
  color: var(--text); text-decoration: none; white-space: nowrap;
  display: inline-flex; align-items: center; gap: 8px; flex-shrink: 0;
}
.brand:hover { text-decoration: none; opacity: 0.88; }
.brand-dot {
  width: 8px; height: 8px; border-radius: 50%; background: var(--accent);
  box-shadow: 0 0 10px var(--accent);
  display: inline-block;
}
.nav {
  display: flex; align-items: center; gap: 3px; overflow-x: auto;
  scrollbar-width: none; -ms-overflow-style: none; flex: 1; min-width: 0;
}
.nav::-webkit-scrollbar { display: none; }
.nav a {
  padding: 6px 11px; border-radius: 10px; font-size: 13.5px; font-weight: 500;
  color: var(--muted); white-space: nowrap; transition: background 0.16s, color 0.16s;
}
.nav a:hover { background: var(--surface-subtle); color: var(--text); text-decoration: none; }
.nav a.active {
  background: var(--accent-soft); color: var(--accent); font-weight: 600;
  box-shadow: inset 0 0 0 1px var(--accent-border);
}

/* Header search trigger button (opens slide-down search drawer) */
.search-trigger {
  margin-left: auto; flex-shrink: 0;
  display: inline-flex; align-items: center; gap: 7px;
  padding: 7px 12px; border-radius: var(--radius-pill);
  border: 1px solid var(--line-strong);
  background: var(--surface); color: var(--text-sub);
  font: 13px/1 inherit; font-weight: 600; cursor: pointer;
  transition: border-color 0.16s, background 0.16s, box-shadow 0.16s, transform 0.16s;
}
.search-trigger:hover {
  border-color: var(--accent-border); color: var(--text);
  box-shadow: var(--accent-glow); transform: translateY(-1px);
}
.search-trigger svg { width: 15px; height: 15px; flex-shrink: 0; }
.search-trigger .kbd {
  font-size: 11px; font-weight: 600; color: var(--muted);
  background: var(--surface-subtle); border: 1px solid var(--line);
  padding: 2px 6px; border-radius: 6px;
}
.search-badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; padding: 0 5px; border-radius: var(--radius-pill);
  background: var(--accent); color: #fff; font-size: 11px; font-weight: 700;
}

/* Slide-down unified search drawer */
.search-backdrop {
  position: fixed; inset: 0; z-index: 90;
  background: var(--backdrop);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  opacity: 0; pointer-events: none;
  transition: opacity 0.24s ease;
}
body.search-open .search-backdrop { opacity: 1; pointer-events: auto; }

.search-drawer {
  position: fixed; top: 0; left: 0; right: 0; z-index: 100;
  background: var(--drawer-bg);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border-bottom: 1px solid var(--line-strong);
  box-shadow: var(--shadow-drawer);
  border-radius: 0 0 22px 22px;
  transform: translateY(-106%);
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  max-height: 88dvh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
body.search-open .search-drawer { transform: translateY(0); }

.search-drawer-inner {
  max-width: 880px; margin: 0 auto; padding: 18px 18px 22px;
}
.search-drawer-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  margin-bottom: 14px;
}
.search-drawer-title {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 15px; font-weight: 700; letter-spacing: -0.01em; color: var(--text);
}
.search-drawer-title svg { width: 17px; height: 17px; color: var(--accent); }
.drawer-close {
  display: inline-flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; border-radius: var(--radius-pill);
  border: 1px solid var(--line); background: var(--surface-subtle);
  color: var(--text-sub); cursor: pointer; font-size: 16px;
  transition: background 0.15s, color 0.15s;
}
.drawer-close:hover { background: var(--accent-soft); color: var(--accent); }

.drawer-form { display: flex; flex-direction: column; gap: 12px; }
.drawer-keyword-wrap {
  display: flex; align-items: center; gap: 8px;
  background: var(--surface-solid);
  border: 1.5px solid var(--line-strong);
  border-radius: 14px; padding: 4px 6px 4px 14px;
  transition: border-color 0.16s, box-shadow 0.16s;
}
.drawer-keyword-wrap:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.drawer-keyword-wrap svg { width: 18px; height: 18px; color: var(--muted); flex-shrink: 0; }
.drawer-search-input {
  border: 0; background: transparent; color: var(--text);
  font-size: 16px; line-height: 1.4; font-family: inherit;
  width: 100%; padding: 8px 4px; outline: none;
}
.drawer-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(165px, 1fr)); gap: 8px;
}
.drawer-field { display: flex; flex-direction: column; gap: 4px; }
.drawer-field label { font-size: 11.5px; font-weight: 600; color: var(--muted); padding-left: 2px; }
.drawer-checks {
  display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; padding: 2px 0;
}
.drawer-checks label {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 13.5px; color: var(--text-sub); cursor: pointer;
}
.drawer-checks input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--accent); }
.drawer-actions {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px;
  padding-top: 6px; border-top: 1px solid var(--line);
}

/* Compact filter bar on list/stats pages */
.filter-bar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  padding: 12px 14px;
}
.filter-bar-btn {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 8px 14px; border-radius: var(--radius-pill);
  border: 1px solid var(--accent-border);
  background: var(--accent-soft); color: var(--accent);
  font: 13.5px/1.2 inherit; font-weight: 600; cursor: pointer;
  transition: background 0.16s, box-shadow 0.16s, transform 0.16s;
}
.filter-bar-btn:hover { box-shadow: var(--accent-glow); transform: translateY(-1px); }
.filter-bar-btn svg { width: 15px; height: 15px; }

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
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
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
.bento-kpi-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: 14px; }
.kpi-card {
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-card);
  padding: 18px 20px; box-shadow: var(--shadow-card);
  display: block; color: inherit; text-decoration: none;
  transition: border-color 0.18s, box-shadow 0.18s, transform 0.18s;
}
a.kpi-card:hover {
  text-decoration: none; border-color: var(--accent-border);
  box-shadow: var(--accent-glow); transform: translateY(-2px);
}
.kpi-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
.kpi-label { font-size: 12.5px; color: var(--muted); font-weight: 600; }
.kpi-arrow { font-size: 13px; color: var(--accent); opacity: 0.8; }
.kpi-value { font-size: 32px; font-weight: 800; letter-spacing: -0.035em; line-height: 1.15; }
.kpi-unit { font-size: 14px; font-weight: 600; color: var(--muted); margin-left: 3px; }
.kpi-sub { font-size: 12px; color: var(--muted); margin-top: 4px; }

/* Dashboard quick-access tiles (3x2 on desktop, 2x3 on mobile) */
.quick-grid {
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom: 16px;
}
.quick-tile {
  display: flex; flex-direction: column; justify-content: space-between; gap: 8px;
  padding: 14px 15px; border-radius: 16px;
  background: var(--surface); border: 1px solid var(--line);
  box-shadow: var(--shadow-card); color: var(--text); text-decoration: none;
  transition: border-color 0.18s, box-shadow 0.18s, transform 0.18s;
}
.quick-tile:hover {
  text-decoration: none; border-color: var(--accent-border);
  box-shadow: var(--accent-glow); transform: translateY(-2px);
}
.quick-tile-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.quick-icon {
  width: 32px; height: 32px; border-radius: 10px;
  background: var(--accent-soft); color: var(--accent);
  display: inline-flex; align-items: center; justify-content: center;
}
.quick-icon svg { width: 17px; height: 17px; }
.quick-title { font-size: 14px; font-weight: 700; letter-spacing: -0.01em; }
.quick-desc { font-size: 11.5px; color: var(--muted); line-height: 1.4; }

.bento-2col { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: 16px; margin-top: 16px; align-items: start; }
.bento-equal { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 16px; align-items: start; }
.bento-3col { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.compact-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.compact-card {
  display: flex; flex-direction: column; justify-content: space-between; gap: 6px;
  padding: 12px 14px; border-radius: 14px;
  background: var(--surface-subtle); border: 1px solid var(--line);
  color: inherit; text-decoration: none;
  transition: border-color 0.16s, background 0.16s, transform 0.16s;
}
.compact-card:hover {
  text-decoration: none; border-color: var(--accent-border);
  background: var(--surface-solid); transform: translateY(-1px);
}
.compact-card-head {
  display: flex; justify-content: space-between; align-items: baseline; gap: 6px;
}
.compact-card-title { font-size: 14px; font-weight: 700; line-height: 1.35; }
.compact-card-count { font-size: 16px; font-weight: 800; white-space: nowrap; }
.compact-card-desc {
  font-size: 11.5px; color: var(--muted); line-height: 1.45;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.chart-legend {
  display: inline-flex; align-items: center; gap: 12px; font-size: 12px; color: var(--muted); font-weight: 500;
}
.chart-legend-item { display: inline-flex; align-items: center; gap: 5px; }
.chart-dot { width: 9px; height: 9px; border-radius: 3px; display: inline-block; }
.segmented {
  display: inline-flex; align-items: center; gap: 2px;
  padding: 3px; border-radius: 999px;
  background: var(--surface-subtle); border: 1px solid var(--line);
}
.segmented a, .segmented button {
  border: 0; background: transparent; color: var(--muted);
  padding: 6px 14px; border-radius: 999px; font: 13px/1.2 inherit; font-weight: 600;
  cursor: pointer; text-decoration: none; white-space: nowrap;
  transition: background 0.16s, color 0.16s;
}
.segmented a:hover, .segmented button:hover { color: var(--text); text-decoration: none; }
.segmented .is-active {
  background: var(--accent); color: #fff;
  box-shadow: 0 2px 8px rgba(59, 91, 219, 0.28);
}

/* Horizontal progress-bar cards (Top themes & Stats occupations) */
.bar-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.bar-card {
  display: flex; flex-direction: column; gap: 8px;
  padding: 13px 15px; border-radius: 14px;
  background: var(--surface-subtle); border: 1px solid var(--line);
  color: inherit; text-decoration: none;
  transition: border-color 0.16s, background 0.16s, transform 0.16s, box-shadow 0.16s;
}
.bar-card:hover {
  text-decoration: none; border-color: var(--accent-border);
  background: var(--surface-solid); transform: translateY(-1px);
  box-shadow: var(--accent-glow);
}
.bar-card-head {
  display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
}
.bar-card-label { font-size: 14px; font-weight: 700; color: var(--text); }
.bar-card-val { font-size: 16px; font-weight: 800; color: var(--text); white-space: nowrap; }
.bar-track {
  width: 100%; height: 7px; border-radius: 999px;
  background: var(--track); overflow: hidden;
}
.bar-fill {
  height: 100%; border-radius: 999px;
  background: linear-gradient(90deg, var(--accent), var(--accent-bright));
  box-shadow: 0 0 10px rgba(116, 143, 252, 0.35);
}

/* 100% stacked gender ratio bar */
.ratio-bar {
  display: flex; width: 100%; height: 30px; border-radius: 10px; overflow: hidden;
  background: var(--track); margin-bottom: 14px;
}
.ratio-seg {
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden;
  padding: 0 6px; text-decoration: none;
  transition: filter 0.15s;
}
.ratio-seg:hover { filter: brightness(1.1); text-decoration: none; color: #fff; }

/* Nationality horizontal stacked bar chart */
.nat-list { display: flex; flex-direction: column; gap: 10px; }
.nat-row {
  display: grid; grid-template-columns: 112px minmax(0, 1fr) 52px; align-items: center; gap: 10px;
  padding: 6px 8px; border-radius: 10px; color: inherit; text-decoration: none;
  transition: background 0.15s;
}
.nat-row:hover { background: var(--surface-subtle); text-decoration: none; }
.nat-label { font-size: 13.5px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nat-track {
  display: flex; align-items: center; height: 18px; border-radius: 6px;
  background: var(--track); overflow: hidden;
}
.nat-seg { height: 100%; }
.nat-count { text-align: right; font-size: 13.5px; font-weight: 700; color: var(--text); }

/* Tags & pills */
.pills { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.pill {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 11px; border-radius: var(--radius-pill);
  font-size: 12.5px; font-weight: 500; line-height: 1.3;
  background: var(--surface-subtle); color: var(--text-sub); border: 1px solid var(--line);
  text-decoration: none; transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.pill:hover { border-color: var(--accent-border); color: var(--accent); text-decoration: none; }
.pill-accent {
  background: var(--accent-soft); color: var(--accent); border-color: var(--accent-border); font-weight: 600;
}
.pill-count {
  font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums;
  background: var(--surface-solid); padding: 1px 6px; border-radius: var(--radius-pill);
}

/* Stage color-coded badges (light & dark balanced) */
.pill-stage-occurred {
  background: rgba(100, 116, 139, 0.14); color: #475569; border-color: rgba(100, 116, 139, 0.3); font-weight: 700;
}
.pill-stage-arrest {
  background: rgba(245, 158, 11, 0.14); color: #b45309; border-color: rgba(245, 158, 11, 0.35); font-weight: 700;
}
.pill-stage-indict {
  background: rgba(59, 91, 219, 0.13); color: #3b5bdb; border-color: rgba(59, 91, 219, 0.32); font-weight: 700;
}
.pill-stage-judgment {
  background: rgba(14, 165, 233, 0.14); color: #0369a1; border-color: rgba(14, 165, 233, 0.35); font-weight: 700;
}
.pill-stage-final {
  background: rgba(16, 185, 129, 0.14); color: #047857; border-color: rgba(16, 185, 129, 0.35); font-weight: 700;
}
.pill-stage-other {
  background: rgba(139, 92, 246, 0.13); color: #6d28d9; border-color: rgba(139, 92, 246, 0.32); font-weight: 700;
}
.badge-new {
  display: inline-flex; align-items: center; padding: 2px 7px; border-radius: var(--radius-pill);
  font-size: 10.5px; font-weight: 800; letter-spacing: 0.04em;
  background: rgba(16, 185, 129, 0.16); color: #047857; border: 1px solid rgba(16, 185, 129, 0.35);
}
.badge-update {
  display: inline-flex; align-items: center; padding: 2px 7px; border-radius: var(--radius-pill);
  font-size: 10.5px; font-weight: 700;
  background: rgba(14, 165, 233, 0.14); color: #0369a1; border: 1px solid rgba(14, 165, 233, 0.32);
}
@media (prefers-color-scheme: dark) {
  .pill-stage-occurred { background: rgba(148, 163, 184, 0.16); color: #cbd5e1; border-color: rgba(148, 163, 184, 0.3); }
  .pill-stage-arrest { background: rgba(251, 191, 36, 0.16); color: #fbbf24; border-color: rgba(251, 191, 36, 0.36); }
  .pill-stage-indict { background: rgba(116, 143, 252, 0.18); color: #91a7ff; border-color: rgba(116, 143, 252, 0.38); }
  .pill-stage-judgment { background: rgba(56, 189, 248, 0.16); color: #38bdf8; border-color: rgba(56, 189, 248, 0.38); }
  .pill-stage-final { background: rgba(52, 211, 153, 0.16); color: #34d399; border-color: rgba(52, 211, 153, 0.38); }
  .pill-stage-other { background: rgba(167, 139, 250, 0.16); color: #c4b5fd; border-color: rgba(167, 139, 250, 0.36); }
  .badge-new { background: rgba(52, 211, 153, 0.18); color: #34d399; border-color: rgba(52, 211, 153, 0.38); }
  .badge-update { background: rgba(56, 189, 248, 0.16); color: #38bdf8; border-color: rgba(56, 189, 248, 0.36); }
}

/* Collapsible statutory article */
.article-details {
  border: 1px solid var(--line); border-radius: 12px; background: var(--surface-subtle);
  overflow: hidden;
}
.article-summary {
  list-style: none; cursor: pointer; padding: 10px 14px;
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  font-size: 13px; font-weight: 700; color: var(--accent); user-select: none;
}
.article-summary::-webkit-details-marker { display: none; }
.article-summary::after { content: "▾"; font-size: 13px; transition: transform 0.18s; }
.article-details[open] .article-summary::after { transform: rotate(180deg); }
.article-body {
  padding: 0 14px 14px; border-top: 1px solid var(--line);
  padding-top: 10px; color: var(--text-sub); white-space: pre-line; font-size: 13px; line-height: 1.75;
}

/* Compact statutory penalty row & visual demographic sentencing rows */
.penalty-strip {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px;
  padding: 10px 13px; border-radius: 12px; background: var(--surface-subtle); border: 1px solid var(--line);
  font-size: 13px; margin-bottom: 10px;
}
.demo-sent-list { display: flex; flex-direction: column; gap: 10px; }
.demo-sent-row {
  display: grid; grid-template-columns: 96px minmax(0, 1fr) 92px; align-items: center; gap: 10px;
  padding: 10px 12px; border-radius: 12px; background: var(--surface-subtle); border: 1px solid var(--line);
}
.demo-sent-label { font-size: 13.5px; font-weight: 700; color: var(--text); line-height: 1.3; }
.demo-sent-count { font-size: 11.5px; color: var(--muted); font-weight: 500; display: block; }
.demo-sent-bar {
  display: flex; height: 26px; border-radius: 8px; overflow: hidden; background: var(--track);
}
.demo-sent-seg {
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; padding: 0 5px;
}
.demo-sent-muted { font-size: 12px; color: var(--muted); }
.demo-sent-ratio { text-align: right; line-height: 1.25; }
.demo-sent-ratio strong { font-size: 14px; color: var(--text); }
.demo-sent-ci { font-size: 10.5px; color: var(--muted); display: block; }

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
  width: 14px; height: 14px; border-radius: 50%; background: var(--surface-solid);
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
  border-radius: 50%; background: var(--accent); border: 2px solid var(--surface-solid);
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

/* Forms & buttons — 16px font-size prevents iOS Safari auto-zoom on focus */
.filter-form { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.input, select.input, textarea.input {
  font: 16px/1.4 inherit; padding: 8px 11px; border: 1px solid var(--line-strong);
  border-radius: 12px; background: var(--surface-solid); color: var(--text); max-width: 100%;
  min-height: 40px;
}
.input:focus, select.input:focus, textarea.input:focus {
  outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft);
}
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  font: 13.5px/1.3 inherit; font-weight: 600; padding: 9px 15px;
  border-radius: 12px; border: 1px solid var(--line-strong); background: var(--surface-solid);
  color: var(--text); cursor: pointer; text-decoration: none;
  transition: background 0.15s, border-color 0.15s, transform 0.15s;
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
  padding: 24px 16px; margin-top: 28px;
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
  .bento-3col, .compact-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .quick-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  .header-inner { gap: 8px; padding: 10px 14px; }
  .brand { font-size: 16.5px; }
  .search-trigger { padding: 7px 11px; }
  .search-trigger .kbd { display: none; }
  .container { padding: 14px 12px 36px; }
  .card { padding: 16px; border-radius: 16px; }
  .bento-kpi { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .bento-kpi .kpi-card { display: block; padding: 11px 10px; }
  .bento-kpi .kpi-label { font-size: 11px; }
  .bento-kpi .kpi-value { font-size: 20px; }
  .bento-kpi .kpi-unit { font-size: 11.5px; }
  .bento-kpi .kpi-sub { font-size: 10.5px; }
  .bento-kpi-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .bento-kpi-2 .kpi-card { padding: 14px 14px; }
  .bento-kpi-2 .kpi-value { font-size: 26px; }
  .kpi-value { font-size: 24px; }
  .quick-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .quick-tile { padding: 12px 13px; gap: 6px; }
  .bento-3col { grid-template-columns: 1fr; }
  .compact-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .compact-card { padding: 10px 11px; gap: 4px; }
  .compact-card-title { font-size: 13px; }
  .compact-card-count { font-size: 14.5px; }
  .bar-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .bar-card { padding: 11px 12px; gap: 6px; }
  .bar-card-label { font-size: 13px; }
  .bar-card-val { font-size: 14.5px; }
  .nat-row { grid-template-columns: 88px minmax(0, 1fr) 44px; gap: 8px; padding: 5px 4px; }
  .nat-label, .nat-count { font-size: 12.5px; }
  .demo-sent-row { grid-template-columns: 74px minmax(0, 1fr) 74px; gap: 8px; padding: 9px 10px; }
  .demo-sent-label { font-size: 12.5px; }
  .demo-sent-ratio strong { font-size: 13px; }
  .page-h1 { font-size: 20px; }
  .hide-sm { display: none; }
  .drawer-grid { grid-template-columns: 1fr 1fr; }
}
`;

const DRAWER_SCRIPT = `
(() => {
  const openBtns = document.querySelectorAll("[data-open-search]");
  const closeBtns = document.querySelectorAll("[data-close-search]");
  const drawer = document.getElementById("cw-search-drawer");
  if (!drawer) return;
  const open = () => {
    document.body.classList.add("search-open");
    drawer.setAttribute("aria-hidden", "false");
    const inp = drawer.querySelector("input[type='search'], input[type='text']");
    if (inp) setTimeout(() => inp.focus({ preventScroll: true }), 120);
  };
  const close = () => {
    document.body.classList.remove("search-open");
    drawer.setAttribute("aria-hidden", "true");
  };
  openBtns.forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); open(); }));
  closeBtns.forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); close(); }));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("search-open")) close();
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      document.body.classList.contains("search-open") ? close() : open();
    }
  });
})();
`;

function renderDefaultDrawerBody(searchQuery: string | undefined) {
  return html`
    <form method="get" action="/cases" class="drawer-form" role="search">
      <div class="drawer-keyword-wrap">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path>
        </svg>
        <input
          class="drawer-search-input"
          type="search"
          name="q"
          value="${searchQuery ?? ""}"
          placeholder="キーワード・罪状・事件名で検索"
          aria-label="キーワード・罪状で検索"
        />
        <button class="btn btn-primary" type="submit" style="padding:8px 16px;border-radius:10px">検索</button>
      </div>
      <div class="drawer-grid">
        <div class="drawer-field">
          <label for="cw-d-pref">都道府県</label>
          <select id="cw-d-pref" class="input" name="prefecture">
            <option value="">すべて</option>
            ${PREFECTURES.map((p) => html`<option value="${p}">${p}</option>`)}
          </select>
        </div>
        <div class="drawer-field">
          <label for="cw-d-theme">テーマ</label>
          <select id="cw-d-theme" class="input" name="theme">
            <option value="">すべて</option>
            ${THEMES.map((t) => html`<option value="${t}">${t}</option>`)}
          </select>
        </div>
        <div class="drawer-field">
          <label for="cw-d-prog">進み具合</label>
          <select id="cw-d-prog" class="input" name="progress">
            <option value="">すべて</option>
            ${QUICK_PROGRESS_OPTIONS.map((pr) => html`<option value="${pr}">${pr}</option>`)}
          </select>
        </div>
      </div>
      <div class="drawer-checks">
        <label><input type="checkbox" name="has_judgment" value="1" /> 判決ありのみ</label>
        <label><input type="checkbox" name="juvenile" value="1" /> 少年事件のみ</label>
      </div>
      <div class="drawer-actions">
        <a class="btn" href="/cases">事件一覧でさらに詳しく</a>
        <button class="btn btn-primary" type="submit">この条件で検索</button>
      </div>
    </form>
  `;
}

export function renderLayout(opts: LayoutOptions) {
  const origin = opts.origin ?? "";
  const canonicalUrl = opts.canonicalPath ? `${origin}${opts.canonicalPath}` : undefined;
  const ogImageUrl = `${origin}${opts.ogImagePath ?? "/og/default.svg"}`;
  const desc = opts.description ?? "日本国内の犯罪報道と判決（量刑・裁判所・担当裁判官）を事実のみに基づいて記録・公開するデータアーカイブ。";
  const filterCount = opts.activeFilterCount ?? 0;

  return html`<!doctype html>
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${opts.title}</title>
        <meta name="description" content="${desc}" />
        ${opts.noindex ? html`<meta name="robots" content="noindex, nofollow" />` : ""}
        ${canonicalUrl ? html`<link rel="canonical" href="${canonicalUrl}" />` : ""}
        <meta property="og:site_name" content="HANZAI Watch" />
        <meta property="og:title" content="${opts.title}" />
        <meta property="og:description" content="${desc}" />
        <meta property="og:type" content="${opts.ogType ?? "website"}" />
        ${canonicalUrl ? html`<meta property="og:url" content="${canonicalUrl}" />` : ""}
        <meta property="og:image" content="${ogImageUrl}" />
        <meta name="twitter:card" content="summary_large_image" />
        <link rel="alternate" type="application/rss+xml" title="HANZAI Watch RSS" href="/feed.xml" />
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
            <a class="brand" href="/"><span class="brand-dot" aria-hidden="true"></span>HANZAI Watch</a>
            <button type="button" class="search-trigger" data-open-search aria-label="検索・絞り込みを開く">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path>
              </svg>
              <span class="search-trigger-label">検索</span>
              ${filterCount > 0
                ? html`<span class="search-badge num">${filterCount}</span>`
                : html`<span class="kbd">⌘K</span>`}
            </button>
          </div>
        </header>

        <div class="search-backdrop" data-close-search aria-hidden="true"></div>
        <aside id="cw-search-drawer" class="search-drawer" role="dialog" aria-modal="true" aria-hidden="true" aria-label="${opts.drawerTitle ?? "事件を検索・絞り込み"}">
          <div class="search-drawer-inner">
            <div class="search-drawer-head">
              <div class="search-drawer-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path>
                </svg>
                <span>${opts.drawerTitle ?? "事件を検索・絞り込み"}</span>
              </div>
              <button type="button" class="drawer-close" data-close-search aria-label="閉じる">✕</button>
            </div>
            ${opts.drawerBody ?? renderDefaultDrawerBody(opts.searchQuery)}
          </div>
        </aside>

        <main class="container">${opts.body}</main>
        <footer class="site-footer">
          <div class="footer-inner">
            <div>HANZAI Watch — 報道・判決で明らかになった事実のみを記録します</div>
            <div class="footer-links">
              <a href="/about">このサイトについて</a>
              <a href="/contact">削除・訂正の依頼</a>
              <a href="/feed.xml">RSS</a>
            </div>
          </div>
        </footer>
        <script>
          ${raw(DRAWER_SCRIPT)}
        </script>
      </body>
    </html>`;
}
