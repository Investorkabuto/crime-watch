// 都道府県一覧（/prefectures）と 都道府県別ページ（/prefectures/:name）
import type { Context } from "hono";
import { html, raw } from "hono/html";
import type { Env } from "../../env";
import { safeDecodeURIComponent } from "../../normalize";
import { PREF_EXPR, prefectureStats } from "../../prefstats";
import { PREFECTURES } from "../../schema";
import { formatDateShort, formatPct, stageBadgeClass } from "../format";
import { JAPAN_VIEWBOX, MAP_INSET_LINES, MAP_PREFECTURES, MAP_REGIONS, type RegionId } from "../japan-map-data";
import { renderLayout } from "../layout";
import { per100k } from "../population";

const PREF_SET = new Set<string>([...PREFECTURES, "不明"]);

function heatLevel(cases: number, maxCases: number): number {
  if (cases <= 0 || maxCases <= 0) return 0;
  const ratio = cases / maxCases;
  if (ratio <= 0.15) return 1;
  if (ratio <= 0.35) return 2;
  if (ratio <= 0.65) return 3;
  return 4;
}

const PREF_MAP_CSS = `
.pref-controls {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px;
  margin-bottom: 14px;
}
.segmented {
  display: inline-flex; align-items: center; gap: 2px;
  padding: 3px; border-radius: 999px;
  background: var(--surface-subtle); border: 1px solid var(--line);
}
.segmented a, .segmented button {
  border: 0; background: transparent; color: var(--muted);
  padding: 6px 12px; border-radius: 999px; font-size: 12.5px; line-height: 1.2; font-family: inherit; font-weight: 600;
  cursor: pointer; text-decoration: none; white-space: nowrap;
  transition: background 0.16s, color 0.16s;
}
.segmented a:hover, .segmented button:hover { color: var(--text); text-decoration: none; }
.segmented .is-active {
  background: var(--accent); color: #fff;
  box-shadow: 0 2px 8px rgba(59, 91, 219, 0.28);
}
.region-pills {
  display: flex; flex-wrap: nowrap; gap: 6px; overflow-x: auto;
  padding-bottom: 4px; margin-bottom: 12px;
  scrollbar-width: none; -ms-overflow-style: none;
}
.region-pills::-webkit-scrollbar { display: none; }
.region-pill {
  flex-shrink: 0; border: 1px solid var(--line); background: var(--surface-subtle);
  color: var(--text-sub); padding: 5px 12px; border-radius: 999px;
  font-size: 12.5px; line-height: 1.3; font-family: inherit; font-weight: 600; cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}
.region-pill:hover { border-color: var(--accent-border); color: var(--accent); }
.region-pill.is-active {
  background: var(--accent-soft); border-color: var(--accent-border); color: var(--accent);
}

.map-stage {
  position: relative;
  border-radius: 16px;
  overflow: hidden;
  border: 1px solid var(--line);
  background:
    radial-gradient(ellipse 70% 60% at 50% 45%, rgba(116, 143, 252, 0.10), transparent 72%),
    var(--surface-subtle);
  aspect-ratio: 10 / 9;
  max-height: 540px;
  width: 100%;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.map-stage.is-zoomed {
  border-color: var(--accent-border);
  box-shadow: var(--accent-glow);
}
.japan-svg {
  width: 100%; height: 100%; display: block;
}
.map-inset-line {
  stroke: var(--line-strong); stroke-width: 2; stroke-dasharray: 6 6; opacity: 0.7;
  pointer-events: none;
}
.pref-shape {
  cursor: pointer;
  stroke: var(--bg);
  stroke-width: 1.6;
  stroke-linejoin: round;
  transition: fill 0.2s ease, opacity 0.25s ease, filter 0.2s ease, stroke-width 0.2s ease;
}
.pref-shape[data-lvl="0"] { fill: rgba(148, 163, 184, 0.22); }
.pref-shape[data-lvl="1"] { fill: rgba(116, 143, 252, 0.34); }
.pref-shape[data-lvl="2"] { fill: rgba(116, 143, 252, 0.54); }
.pref-shape[data-lvl="3"] { fill: rgba(92, 124, 250, 0.76); }
.pref-shape[data-lvl="4"] { fill: #5c7cfa; }
@media (prefers-color-scheme: dark) {
  .pref-shape[data-lvl="0"] { fill: #1e273a; }
  .pref-shape[data-lvl="1"] { fill: #2b3b63; }
  .pref-shape[data-lvl="2"] { fill: #3b5392; }
  .pref-shape[data-lvl="3"] { fill: #5371c9; }
  .pref-shape[data-lvl="4"] { fill: #748ffc; }
}
.pref-shape:hover {
  filter: brightness(1.18);
  stroke: var(--accent-bright);
  stroke-width: 2.2;
}
.map-stage.is-zoomed .pref-shape:not(.in-region) {
  opacity: 0.2;
  filter: saturate(0.4);
}
.map-stage.is-zoomed .pref-shape.in-region {
  stroke-width: 1.1;
}
.pref-shape.is-selected {
  fill: var(--accent) !important;
  stroke: #ffffff !important;
  stroke-width: 2.4 !important;
  filter: drop-shadow(0 0 8px rgba(116, 143, 252, 0.65));
}

.pref-label {
  font-size: 13px; font-weight: 700;
  fill: var(--text);
  text-anchor: middle; dominant-baseline: central;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.25s ease;
  paint-order: stroke;
  stroke: var(--bg);
  stroke-width: 3.5px;
  stroke-linejoin: round;
}
.map-stage.is-zoomed .pref-label.in-region { opacity: 0.96; }

.map-back-btn {
  position: absolute; top: 12px; left: 12px; z-index: 5;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 13px; border-radius: 999px;
  background: var(--drawer-bg);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--line-strong);
  color: var(--text); font-size: 12.5px; line-height: 1.2; font-family: inherit; font-weight: 600;
  cursor: pointer; box-shadow: var(--shadow-card);
  opacity: 0; pointer-events: none; transform: translateY(-6px);
  transition: opacity 0.2s ease, transform 0.2s ease, border-color 0.15s;
}
.map-stage.is-zoomed .map-back-btn {
  opacity: 1; pointer-events: auto; transform: translateY(0);
}
.map-back-btn:hover { border-color: var(--accent-border); color: var(--accent); }

.map-hint {
  position: absolute; top: 12px; right: 12px; z-index: 4;
  padding: 5px 11px; border-radius: 999px;
  background: var(--drawer-bg); border: 1px solid var(--line);
  font-size: 11.5px; color: var(--muted); pointer-events: none;
}

.map-dock {
  margin-top: 12px;
  padding: 12px 16px;
  border-radius: 14px;
  background: var(--surface-subtle);
  border: 1px solid var(--line);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 16px;
  min-height: 58px;
  transition: border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
}
.map-dock.is-active {
  background: var(--surface-solid);
  border-color: var(--accent-border);
  box-shadow: var(--accent-glow);
}
.map-dock-empty {
  font-size: 13px;
  color: var(--muted);
}
.map-dock-info {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 14px;
}
.map-dock-name {
  font-size: 16px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--text);
}
.map-dock-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  font-size: 13px;
  color: var(--text-sub);
}
.map-dock-metrics strong {
  color: var(--text);
  font-size: 14px;
}
.map-dock-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.map-legend {
  position: absolute; left: 12px; bottom: 12px; z-index: 4;
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 10px; border-radius: 999px;
  background: var(--drawer-bg); border: 1px solid var(--line);
  font-size: 11px; color: var(--muted);
}
.legend-swatch { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }

.is-hidden-view { display: none !important; }
tr.is-region-hidden { display: none; }

@media (max-width: 640px) {
  .map-stage { aspect-ratio: 1 / 1; max-height: 440px; }
  .map-hint { display: none; }
  .map-legend { display: none; }
  .map-dock { padding: 12px 14px; }
  .map-dock-actions { width: 100%; margin-left: 0; }
  .map-dock-actions .btn { flex: 1; }
}
`;

/** 都道府県一覧 /prefectures */
export async function renderPrefecturesListPage(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const origin = new URL(c.req.url).origin;
  const stats = await prefectureStats(db, { basis: "occurrence" });

  const statByName = new Map(stats.prefectures.map((r) => [r.prefecture, r]));
  const regionByName = new Map<string, RegionId>(MAP_PREFECTURES.map((p) => [p.name, p.region]));
  const maxCases = Math.max(0, ...stats.prefectures.filter((r) => r.prefecture !== "不明").map((r) => r.cases));

  const mapDataPayload = MAP_PREFECTURES.map((p) => {
    const row = statByName.get(p.name);
    const cases = row?.cases ?? 0;
    const rate = per100k(cases, p.name);
    return {
      name: p.name,
      region: p.region,
      cases,
      judgments: row?.judgments ?? 0,
      rate: rate != null ? rate.toFixed(2) : "—",
      href: `/prefectures/${encodeURIComponent(p.name)}`,
    };
  });

  const regionsPayload = MAP_REGIONS.map((r) => ({ id: r.id, label: r.label, viewBox: r.viewBox }));

  const mapScript = `
(() => {
  const stage = document.getElementById("cw-map-stage");
  const svg = document.getElementById("cw-japan-svg");
  if (!stage || !svg) return;

  const JAPAN_VB = ${JSON.stringify(JAPAN_VIEWBOX)};
  const REGIONS = ${JSON.stringify(regionsPayload)};
  const PREF_DATA = Object.fromEntries(${JSON.stringify(mapDataPayload)}.map((d) => [d.name, d]));
  const REGION_MAP = Object.fromEntries(REGIONS.map((r) => [r.id, r]));

  const backBtn = document.getElementById("cw-map-back");
  const hintEl = document.getElementById("cw-map-hint");
  const dock = document.getElementById("cw-map-dock");
  const dockEmpty = document.getElementById("cw-dock-empty");
  const dockContent = document.getElementById("cw-dock-content");
  const dockActions = document.getElementById("cw-dock-actions");
  const dockName = document.getElementById("cw-dock-name");
  const dockCases = document.getElementById("cw-dock-cases");
  const dockRate = document.getElementById("cw-dock-rate");
  const dockJudg = document.getElementById("cw-dock-judg");
  const dockLink = document.getElementById("cw-dock-link");
  const tableHeading = document.getElementById("cw-table-region-label");
  const tableReset = document.getElementById("cw-table-reset");
  const regionBtns = document.querySelectorAll("[data-region-btn]");
  const shapes = svg.querySelectorAll(".pref-shape");
  const labels = svg.querySelectorAll(".pref-label");
  const tableRows = document.querySelectorAll("#cw-pref-tbody tr[data-region]");

  let curVb = [...JAPAN_VB];
  let animId = 0;
  let activeRegion = null;
  let selectedPref = null;

  const animateViewBox = (target) => {
    cancelAnimationFrame(animId);
    const start = [...curVb];
    const t0 = performance.now();
    const dur = 360;
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      curVb = start.map((s, i) => s + (target[i] - s) * e);
      svg.setAttribute("viewBox", curVb.map((n) => n.toFixed(1)).join(" "));
      if (p < 1) animId = requestAnimationFrame(step);
    };
    animId = requestAnimationFrame(step);
  };

  const clearSelection = () => {
    selectedPref = null;
    dock.classList.remove("is-active");
    dockEmpty.classList.remove("is-hidden-view");
    dockContent.classList.add("is-hidden-view");
    dockActions.classList.add("is-hidden-view");
    shapes.forEach((s) => s.classList.remove("is-selected"));
    const reg = activeRegion ? REGION_MAP[activeRegion] : null;
    dockEmpty.textContent = reg
      ? reg.label + "の県をタップすると概要が表示されます（もう一度タップで詳細へ）"
      : "地図の地方をタップして拡大すると、各県の概要と詳細リンクがここに表示されます";
  };

  const selectPrefecture = (name) => {
    const d = PREF_DATA[name];
    if (!d) return;
    selectedPref = name;
    shapes.forEach((s) => s.classList.toggle("is-selected", s.dataset.name === name));
    dockName.textContent = d.name;
    dockCases.textContent = d.cases.toLocaleString("ja-JP") + "件";
    dockRate.textContent = d.rate;
    dockJudg.textContent = d.judgments.toLocaleString("ja-JP") + "件";
    dockLink.setAttribute("href", d.href);
    dock.classList.add("is-active");
    dockEmpty.classList.add("is-hidden-view");
    dockContent.classList.remove("is-hidden-view");
    dockActions.classList.remove("is-hidden-view");
  };

  const setRegion = (regionId) => {
    activeRegion = regionId;
    clearSelection();
    const reg = regionId ? REGION_MAP[regionId] : null;
    stage.classList.toggle("is-zoomed", Boolean(reg));
    animateViewBox(reg ? reg.viewBox : JAPAN_VB);

    shapes.forEach((s) => s.classList.toggle("in-region", !reg || s.dataset.region === regionId));
    labels.forEach((l) => l.classList.toggle("in-region", Boolean(reg && l.dataset.region === regionId)));
    regionBtns.forEach((b) => b.classList.toggle("is-active", (b.dataset.regionBtn || "") === (regionId || "")));

    if (hintEl) hintEl.textContent = reg ? reg.label + "：県をタップして選択" : "地方をタップすると拡大します";
    if (tableHeading) tableHeading.textContent = reg ? "都道府県別データ（" + reg.label + "）" : "都道府県別データ（全国）";
    if (tableReset) tableReset.classList.toggle("is-hidden-view", !reg);
    tableRows.forEach((tr) => {
      tr.classList.toggle("is-region-hidden", Boolean(reg && tr.dataset.region !== regionId));
    });
  };

  shapes.forEach((shape) => {
    shape.addEventListener("click", (e) => {
      e.stopPropagation();
      const regId = shape.dataset.region;
      const name = shape.dataset.name;
      if (!activeRegion || activeRegion !== regId) {
        setRegion(regId);
        if (regId === "hokkaido") selectPrefecture(name);
        return;
      }
      if (selectedPref === name) {
        const d = PREF_DATA[name];
        if (d) window.location.href = d.href;
        return;
      }
      selectPrefecture(name);
    });
  });

  svg.addEventListener("click", () => {
    if (selectedPref) clearSelection();
  });

  backBtn.addEventListener("click", () => setRegion(null));
  if (tableReset) tableReset.addEventListener("click", (e) => { e.preventDefault(); setRegion(null); });
  regionBtns.forEach((b) => {
    b.addEventListener("click", () => {
      const id = b.dataset.regionBtn || null;
      setRegion(id);
      if (id === "hokkaido") selectPrefecture("北海道");
    });
  });

  // 地図 / 一覧 表示モード切替
  const mapCard = document.getElementById("cw-map-card");
  const tableCard = document.getElementById("cw-table-card");
  const modeBtns = document.querySelectorAll("[data-view-mode]");
  modeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.viewMode;
      modeBtns.forEach((b) => b.classList.toggle("is-active", b === btn));
      if (mapCard) mapCard.classList.toggle("is-hidden-view", mode === "table");
      if (tableCard) tableCard.classList.toggle("is-hidden-view", mode === "map");
    });
  });
})();
`;

  const body = html`
    <style>
      ${raw(PREF_MAP_CSS)}
    </style>

    <div class="pref-controls">
      <div>
        <h1 class="page-h1" style="margin-bottom:2px">都道府県別一覧</h1>
        <p class="small muted mb-0">
          合計 <strong class="num">${stats.total_cases.toLocaleString("ja-JP")}</strong> 件（発生地別）
        </p>
      </div>
      <div class="segmented" role="group" aria-label="表示切替">
        <button type="button" class="is-active" data-view-mode="both">地図 + 一覧</button>
        <button type="button" data-view-mode="map">地図のみ</button>
        <button type="button" data-view-mode="table">一覧のみ</button>
      </div>
    </div>

    <section id="cw-map-card" class="card">
      <div class="region-pills" role="group" aria-label="地方でズーム">
        <button type="button" class="region-pill is-active" data-region-btn="">全国</button>
        ${MAP_REGIONS.map(
          (r) => html`<button type="button" class="region-pill" data-region-btn="${r.id}">${r.label}</button>`,
        )}
      </div>

      <div id="cw-map-stage" class="map-stage">
        <button id="cw-map-back" type="button" class="map-back-btn">← 全国に戻る</button>
        <div id="cw-map-hint" class="map-hint">地方をタップすると拡大します</div>

        <svg
          id="cw-japan-svg"
          class="japan-svg"
          viewBox="${JAPAN_VIEWBOX.join(" ")}"
          role="img"
          aria-label="都道府県別の事件件数マップ"
        >
          ${MAP_INSET_LINES.map(
            ([x1, y1, x2, y2]) =>
              html`<line class="map-inset-line" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />`,
          )}
          <g>
            ${MAP_PREFECTURES.map((p) => {
              const row = statByName.get(p.name);
              const cases = row?.cases ?? 0;
              const lvl = heatLevel(cases, maxCases);
              return html`<path
                class="pref-shape"
                d="${p.d}"
                data-name="${p.name}"
                data-region="${p.region}"
                data-lvl="${lvl}"
              ><title>${p.name}: ${cases}件</title></path>`;
            })}
          </g>
          <g>
            ${MAP_PREFECTURES.map(
              (p) =>
                html`<text class="pref-label" x="${p.lx}" y="${p.ly}" data-region="${p.region}">${p.short}</text>`,
            )}
          </g>
        </svg>

        <div class="map-legend" aria-hidden="true">
          <span>少</span>
          <span class="legend-swatch" style="background:rgba(148,163,184,0.3)"></span>
          <span class="legend-swatch" style="background:rgba(116,143,252,0.36)"></span>
          <span class="legend-swatch" style="background:rgba(116,143,252,0.58)"></span>
          <span class="legend-swatch" style="background:rgba(92,124,250,0.8)"></span>
          <span class="legend-swatch" style="background:#748ffc"></span>
          <span>多</span>
        </div>
      </div>

      <div id="cw-map-dock" class="map-dock" role="status" aria-live="polite">
        <div id="cw-dock-empty" class="map-dock-empty">
          地図の地方をタップして拡大すると、各県の概要と詳細リンクがここに表示されます
        </div>
        <div id="cw-dock-content" class="map-dock-info is-hidden-view">
          <span id="cw-dock-name" class="map-dock-name"></span>
          <div class="map-dock-metrics">
            <span>事件数 <strong id="cw-dock-cases" class="num"></strong></span>
            <span>10万人比 <strong id="cw-dock-rate" class="num"></strong></span>
            <span>判決 <strong id="cw-dock-judg" class="num"></strong></span>
          </div>
        </div>
        <div id="cw-dock-actions" class="map-dock-actions is-hidden-view">
          <a id="cw-dock-link" class="btn btn-primary" href="/prefectures" style="padding:8px 16px;font-size:13px">
            詳細を見る →
          </a>
        </div>
      </div>
    </section>

    <section id="cw-table-card" class="card mt-16">
      <h2 class="card-title">
        <span id="cw-table-region-label">都道府県別データ（全国）</span>
        <a id="cw-table-reset" class="small is-hidden-view" href="#">全国をすべて表示</a>
      </h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>都道府県</th>
              <th class="num">事件数</th>
              <th class="num">人口10万人あたり</th>
              <th class="num">判決数</th>
              <th class="num hide-sm">執行猶予率</th>
            </tr>
          </thead>
          <tbody id="cw-pref-tbody">
            ${stats.prefectures.map((r) => {
              const rate = per100k(r.cases, r.prefecture);
              const reg = regionByName.get(r.prefecture) ?? "unknown";
              return html`<tr data-region="${reg}">
                <td>
                  <a href="/prefectures/${encodeURIComponent(r.prefecture)}" style="font-weight:600"
                    >${r.prefecture}</a
                  >
                </td>
                <td class="num">${r.cases.toLocaleString("ja-JP")}</td>
                <td class="num">${rate != null ? rate.toFixed(2) : "—"}</td>
                <td class="num">${r.judgments.toLocaleString("ja-JP")}</td>
                <td class="num hide-sm">
                  ${r.custodial_judgments >= 20 ? formatPct(r.suspended_rate) : "—"}
                </td>
              </tr>`;
            })}
          </tbody>
        </table>
      </div>
    </section>

    <script>
      ${raw(mapScript)}
    </script>
  `;

  return c.html(
    renderLayout({
      title: "都道府県別一覧｜HANZAI Watch",
      description: "47 都道府県ごとの犯罪報道・判決件数と人口 10 万人あたり件数を日本地図と一覧で確認できます。",
      activeNav: "prefectures",
      canonicalPath: "/prefectures",
      origin,
      body,
    }),
  );
}

/** 都道府県別ページ /prefectures/:name */
export async function renderPrefectureDetailPage(c: Context<{ Bindings: Env }>) {
  const name = safeDecodeURIComponent(c.req.param("name") ?? "");
  const origin = new URL(c.req.url).origin;

  if (!name || !PREF_SET.has(name)) {
    return c.html(
      renderLayout({
        title: "都道府県が見つかりません｜HANZAI Watch",
        activeNav: "prefectures",
        origin,
        noindex: true,
        body: html`<section class="card">
          <h1 class="page-h1">都道府県が見つかりません</h1>
          <a class="btn" href="/prefectures">都道府県一覧に戻る</a>
        </section>`,
      }),
      404,
    );
  }

  const db = c.env.DB;
  const prefCond = name === "不明" ? `${PREF_EXPR.occurrence} IS NULL` : `${PREF_EXPR.occurrence} = ?`;
  const binds = name === "不明" ? [] : [name];

  const hasAgg = Boolean(
    await db.prepare("SELECT 1 AS ok FROM agg_meta WHERE key = 'last_aggregated_at' LIMIT 1").first(),
  );

  const [countRes, lawsRes, themesRes, citiesRes, casesRes] = await db.batch([
    db
      .prepare(
        `SELECT COUNT(*) AS cases,
                SUM(CASE WHEN EXISTS (SELECT 1 FROM judgments j WHERE j.case_id = c.id AND j.status = 'published') THEN 1 ELSE 0 END) AS with_judgment
         FROM cases c WHERE c.status = 'published' AND ${prefCond}`,
      )
      .bind(...binds),
    hasAgg
      ? db
          .prepare(
            `SELECT a.law_code AS code, l.name, SUM(a.cases) AS cases
             FROM agg_law_monthly a JOIN laws l ON l.code = a.law_code
             WHERE a.prefecture = ?
             GROUP BY a.law_code, l.name ORDER BY cases DESC LIMIT 12`,
          )
          .bind(name)
      : db
          .prepare(
            `WITH case_laws AS (
               SELECT r.case_id, rc.law_code FROM report_charges rc JOIN reports r ON r.id = rc.report_id WHERE rc.law_code IS NOT NULL
               UNION
               SELECT j.case_id, jc.law_code FROM judgment_charges jc JOIN judgments j ON j.id = jc.judgment_id WHERE jc.law_code IS NOT NULL AND j.status = 'published'
             )
             SELECT l.code, l.name, COUNT(DISTINCT c.id) AS cases
             FROM cases c JOIN case_laws cl ON cl.case_id = c.id JOIN laws l ON l.code = cl.law_code
             WHERE c.status = 'published' AND ${prefCond}
             GROUP BY l.code, l.name ORDER BY cases DESC LIMIT 12`,
          )
          .bind(...binds),
    hasAgg
      ? db
          .prepare(
            `SELECT theme, SUM(cases) AS cases
             FROM agg_theme_monthly
             WHERE prefecture = ?
             GROUP BY theme ORDER BY cases DESC LIMIT 12`,
          )
          .bind(name)
      : db
          .prepare(
            `SELECT ct.theme, COUNT(DISTINCT c.id) AS cases
             FROM cases c JOIN case_themes ct ON ct.case_id = c.id
             WHERE c.status = 'published' AND ${prefCond}
             GROUP BY ct.theme ORDER BY cases DESC LIMIT 12`,
          )
          .bind(...binds),
    db
      .prepare(
        `SELECT c.city, COUNT(*) AS cases
         FROM cases c
         WHERE c.status = 'published' AND ${prefCond} AND c.city IS NOT NULL AND c.city <> ''
         GROUP BY c.city ORDER BY cases DESC LIMIT 12`,
      )
      .bind(...binds),
    db
      .prepare(
        `SELECT c.id, c.title, c.city, c.latest_stage, c.progress, c.latest_at
         FROM cases c
         WHERE c.status = 'published' AND ${prefCond}
         ORDER BY c.latest_at DESC LIMIT 20`,
      )
      .bind(...binds),
  ]);

  const counts = (countRes?.results?.[0] ?? { cases: 0, with_judgment: 0 }) as { cases: number; with_judgment: number };
  const rate = per100k(counts.cases, name);
  const laws = (lawsRes?.results ?? []) as { code: string; name: string; cases: number }[];
  const themes = (themesRes?.results ?? []) as { theme: string; cases: number }[];
  const cities = (citiesRes?.results ?? []) as { city: string; cases: number }[];
  const cases = (casesRes?.results ?? []) as {
    id: string;
    title: string;
    city: string | null;
    latest_stage: string;
    progress: string | null;
    latest_at: string;
  }[];

  const canonicalPath = `/prefectures/${encodeURIComponent(name)}`;

  const body = html`
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px">
      <h1 class="page-h1 mb-0">${name}の事件・判決</h1>
      <a class="pill" href="/prefectures">← 地図に戻る</a>
    </div>

    <section class="bento-kpi">
      <a class="kpi-card" href="/cases?prefecture=${encodeURIComponent(name)}">
        <div class="kpi-head">
          <span class="kpi-label">事件数</span>
          <span class="kpi-arrow" aria-hidden="true">→</span>
        </div>
        <div class="kpi-value num">${counts.cases.toLocaleString("ja-JP")}<span class="kpi-unit">件</span></div>
      </a>
      <div class="kpi-card">
        <div class="kpi-label">人口 10 万人あたり</div>
        <div class="kpi-value num">${rate != null ? rate.toFixed(2) : "—"}<span class="kpi-unit">${rate != null ? "件" : ""}</span></div>
      </div>
      <a class="kpi-card" href="/cases?prefecture=${encodeURIComponent(name)}&has_judgment=1">
        <div class="kpi-head">
          <span class="kpi-label">うち判決あり</span>
          <span class="kpi-arrow" aria-hidden="true">→</span>
        </div>
        <div class="kpi-value num">${(counts.with_judgment ?? 0).toLocaleString("ja-JP")}<span class="kpi-unit">件</span></div>
      </a>
    </section>

    <div class="bento-equal">
      <section class="card">
        <h2 class="card-title">法律別の内訳（${name}）</h2>
        ${laws.length
          ? html`<div class="pills">
              ${laws.map(
                (l) => html`<a
                  class="pill"
                  href="/cases?prefecture=${encodeURIComponent(name)}&law=${encodeURIComponent(l.code)}"
                  >${l.name}<span class="pill-count">${l.cases}</span></a
                >`,
              )}
            </div>`
          : html`<p class="muted small mb-0">データがありません。</p>`}
      </section>
      <section class="card">
        <h2 class="card-title">テーマ別の内訳（${name}）</h2>
        ${themes.length
          ? html`<div class="pills">
              ${themes.map(
                (t) => html`<a
                  class="pill"
                  href="/cases?prefecture=${encodeURIComponent(name)}&theme=${encodeURIComponent(t.theme)}"
                  >${t.theme}<span class="pill-count">${t.cases}</span></a
                >`,
              )}
            </div>`
          : html`<p class="muted small mb-0">データがありません。</p>`}
      </section>
    </div>

    ${cities.length
      ? html`<section class="card mt-16">
          <h2 class="card-title">市区町村別の件数（上位）</h2>
          <div class="pills">
            ${cities.map(
              (ct) => html`<a
                class="pill"
                href="/cases?prefecture=${encodeURIComponent(name)}&city=${encodeURIComponent(ct.city)}"
                >${ct.city}<span class="pill-count">${ct.cases}</span></a
              >`,
            )}
          </div>
        </section>`
      : ""}

    <section class="card mt-16">
      <h2 class="card-title">
        <span>最近の事件</span>
        <a class="small" href="/cases?prefecture=${encodeURIComponent(name)}">すべて見る →</a>
      </h2>
      ${cases.length
        ? html`<ul class="feed">
            ${cases.map(
              (k) => html`<li class="feed-item">
                <div class="feed-meta">
                  <span class="pill ${stageBadgeClass(k.latest_stage)}">${k.latest_stage}</span>
                  ${k.city ? html`<span>${k.city}</span>` : ""}
                  <span class="num">${formatDateShort(k.latest_at)}</span>
                </div>
                <a class="feed-title" href="/cases/${encodeURIComponent(k.id)}">${k.title}</a>
              </li>`,
            )}
          </ul>`
        : html`<p class="muted small mb-0">該当する事件はまだありません。</p>`}
    </section>
  `;

  return c.html(
    renderLayout({
      title: `${name}の事件・判決（${counts.cases}件）｜HANZAI Watch`,
      description: `${name}で発生・報道された事件・判決の集計と一覧。`,
      activeNav: "prefectures",
      canonicalPath,
      origin,
      body,
    }),
  );
}
