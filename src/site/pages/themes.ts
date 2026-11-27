// テーマ一覧（/themes）と テーマ別ページ（/themes/:theme）
import type { Context } from "hono";
import { html } from "hono/html";
import type { Env } from "../../env";
import { nationalityStats } from "../../natstats";
import { THEMES, type Theme } from "../../themes";
import { formatDateShort, stageBadgeClass, THEME_GROUPS, THEME_META } from "../format";
import { renderLayout } from "../layout";
import { renderMonthlyBarChart } from "../svg";

const THEME_SET = new Set<string>(THEMES);

/** テーマ一覧 /themes */
export async function renderThemesListPage(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const origin = new URL(c.req.url).origin;

  const { results } = await db
    .prepare(
      `SELECT ct.theme, COUNT(DISTINCT c.id) AS cases
       FROM case_themes ct
       JOIN cases c ON c.id = ct.case_id
       WHERE c.status = 'published'
       GROUP BY ct.theme`,
    )
    .all<{ theme: string; cases: number }>();

  const countMap = new Map(results.map((r) => [r.theme, r.cases]));

  const body = html`
    <h1 class="page-h1">テーマ一覧</h1>
    <p class="page-lead">
      法律の分類とは別に、事件の特徴や立場・被害者などの切り口で一覧できます。件数は報道された事件の件数です。
    </p>

    ${THEME_GROUPS.map((group) => {
      const items = THEMES.filter((t) => THEME_META[t].group === group);
      return html`<section class="card">
        <h2 class="card-title">${group}</h2>
        <div class="compact-grid">
          ${items.map((t) => {
            const n = countMap.get(t) ?? 0;
            return html`<a class="compact-card" href="/themes/${encodeURIComponent(t)}">
              <div class="compact-card-head">
                <span class="compact-card-title">${t}</span>
                <span class="compact-card-count num">${n}<span class="small muted">件</span></span>
              </div>
              <div class="compact-card-desc">${THEME_META[t].criteria}</div>
            </a>`;
          })}
        </div>
      </section>`;
    })}
  `;

  return c.html(
    renderLayout({
      title: "テーマ一覧｜HANZAI Watch",
      description: "闇バイト・特殊詐欺・飲酒運転・性犯罪などのテーマごとに事件と判決を一覧できます。",
      activeNav: "themes",
      canonicalPath: "/themes",
      origin,
      body,
    }),
  );
}

/** テーマ別ページ /themes/:theme */
export async function renderThemeDetailPage(c: Context<{ Bindings: Env }>) {
  const rawTheme = c.req.param("theme") ?? "";
  const theme = decodeURIComponent(rawTheme);
  const origin = new URL(c.req.url).origin;

  if (!THEME_SET.has(theme)) {
    return c.html(
      renderLayout({
        title: "テーマが見つかりません｜HANZAI Watch",
        activeNav: "themes",
        origin,
        noindex: true,
        body: html`<section class="card">
          <h1 class="page-h1">テーマが見つかりません</h1>
          <p class="muted">指定されたテーマは存在しません。</p>
          <a class="btn" href="/themes">テーマ一覧に戻る</a>
        </section>`,
      }),
      404,
    );
  }

  const db = c.env.DB;
  const meta = THEME_META[theme as Theme];

  const [summaryRes, monthlyRes, prefRes, progRes, casesRes] = await db.batch([
    db
      .prepare(
        `SELECT
           COUNT(DISTINCT c.id) AS total_cases,
           COUNT(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM judgments j WHERE j.case_id = c.id AND j.status = 'published') THEN c.id END) AS with_judgment
         FROM cases c
         JOIN case_themes ct ON ct.case_id = c.id
         WHERE c.status = 'published' AND ct.theme = ?`,
      )
      .bind(theme),
    db
      .prepare(
        `SELECT substr(COALESCE(c.occurred_on, c.latest_at), 1, 7) AS month, COUNT(DISTINCT c.id) AS cases
         FROM cases c
         JOIN case_themes ct ON ct.case_id = c.id
         WHERE c.status = 'published' AND ct.theme = ?
         GROUP BY 1
         ORDER BY 1 ASC`,
      )
      .bind(theme),
    db
      .prepare(
        `SELECT COALESCE(c.prefecture, '不明') AS prefecture, COUNT(DISTINCT c.id) AS cases
         FROM cases c
         JOIN case_themes ct ON ct.case_id = c.id
         WHERE c.status = 'published' AND ct.theme = ?
         GROUP BY 1
         ORDER BY cases DESC, prefecture ASC
         LIMIT 10`,
      )
      .bind(theme),
    db
      .prepare(
        `SELECT COALESCE(c.progress, '不明') AS progress, COUNT(DISTINCT c.id) AS cases
         FROM cases c
         JOIN case_themes ct ON ct.case_id = c.id
         WHERE c.status = 'published' AND ct.theme = ?
         GROUP BY 1
         ORDER BY cases DESC`,
      )
      .bind(theme),
    db
      .prepare(
        `SELECT c.id, c.title, c.prefecture, c.latest_stage, c.progress, c.latest_at
         FROM cases c
         WHERE c.status = 'published'
           AND EXISTS (SELECT 1 FROM case_themes ct WHERE ct.case_id = c.id AND ct.theme = ?)
         ORDER BY c.latest_at DESC
         LIMIT 20`,
      )
      .bind(theme),
  ]);

  const summary = (summaryRes?.results?.[0] ?? { total_cases: 0, with_judgment: 0 }) as {
    total_cases: number;
    with_judgment: number;
  };
  const monthly = (monthlyRes?.results ?? []) as { month: string; cases: number }[];
  const prefs = (prefRes?.results ?? []) as { prefecture: string; cases: number }[];
  const progs = (progRes?.results ?? []) as { progress: string; cases: number }[];
  const cases = (casesRes?.results ?? []) as {
    id: string;
    title: string;
    prefecture: string | null;
    latest_stage: string;
    progress: string | null;
    latest_at: string;
  }[];

  // 「外国人犯罪」テーマは人単位・記載なし別の国籍集計も併記（設計書 §4.3）
  const natData = theme === "外国人犯罪" ? await nationalityStats(db, {}) : null;
  const statedNats = natData ? natData.nationalities.filter((r) => r.nationality !== "記載なし") : [];
  const maxNat = Math.max(1, ...statedNats.map((r) => r.people));

  const judgPct = summary.total_cases > 0 ? Math.round((summary.with_judgment / summary.total_cases) * 100) : 0;
  const maxPref = Math.max(1, ...prefs.map((p) => p.cases));
  const totalProg = progs.reduce((acc, p) => acc + p.cases, 0);
  const progressColor = (prog: string): string => {
    if (prog === "捜査中") return "#f59e0b";
    if (prog === "公判中" || prog === "略式手続") return "var(--accent)";
    if (prog === "判決後（未確定）") return "#38bdf8";
    if (prog === "確定") return "#10b981";
    if (prog === "不起訴" || prog === "処分保留" || prog === "家裁送致") return "#8b5cf6";
    return "var(--muted)";
  };

  const chart = renderMonthlyBarChart(monthly.slice(-12));
  const canonicalPath = `/themes/${encodeURIComponent(theme)}`;

  const body = html`
    <section class="card">
      <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">
        <div class="pills">
          <a class="pill" href="/themes">← テーマ一覧</a>
          <span class="pill">${meta.group}</span>
        </div>
        <a class="pill" href="/themes/${encodeURIComponent(theme)}/feed.xml" aria-label="このテーマのRSS配信">RSS</a>
      </div>
      <h1 class="page-h1">${theme}</h1>
      <p class="page-lead mb-0">${meta.criteria}</p>
    </section>

    <section class="bento-kpi-2 mt-16">
      <a class="kpi-card" href="/cases?theme=${encodeURIComponent(theme)}">
        <div class="kpi-head">
          <span class="kpi-label">事件数</span>
          <span class="kpi-arrow" aria-hidden="true">→</span>
        </div>
        <div class="kpi-value num">${summary.total_cases.toLocaleString("ja-JP")}<span class="kpi-unit">件</span></div>
        <div class="kpi-sub">報道された事件の総数</div>
      </a>
      <a class="kpi-card" href="/cases?theme=${encodeURIComponent(theme)}&has_judgment=1">
        <div class="kpi-head">
          <span class="kpi-label">うち判決あり</span>
          <span class="kpi-arrow" aria-hidden="true">→</span>
        </div>
        <div class="kpi-value num">${summary.with_judgment.toLocaleString("ja-JP")}<span class="kpi-unit">件</span></div>
        <div class="kpi-sub">全体の ${judgPct}%</div>
        <div class="kpi-mini-track" aria-hidden="true">
          <div class="kpi-mini-fill" style="width:${judgPct}%"></div>
        </div>
      </a>
    </section>

    ${chart
      ? html`<section class="card mt-16">
          <h2 class="card-title">月ごとの件数推移</h2>
          ${chart}
        </section>`
      : ""}

    <div class="bento-equal mt-16">
      <section class="card">
        <h2 class="card-title">
          <span>進み具合の内訳</span>
          <span class="small muted">タップで絞り込み</span>
        </h2>
        ${progs.length && totalProg > 0
          ? html`<div class="ratio-bar" role="img" aria-label="進み具合の割合">
                ${progs.map((p) => {
                  const pct = Math.round((p.cases / totalProg) * 100);
                  const w = (p.cases / totalProg) * 100;
                  const col = progressColor(p.progress);
                  return html`<a
                    class="ratio-seg"
                    href="/cases?theme=${encodeURIComponent(theme)}&progress=${encodeURIComponent(p.progress)}"
                    style="width:${w}%;background:${col}"
                    title="${p.progress}: ${p.cases}件（${pct}%）"
                    >${pct >= 15 ? `${p.progress} ${pct}%` : pct >= 8 ? `${pct}%` : ""}</a
                  >`;
                })}
              </div>
              <div class="pills">
                ${progs.map((p) => {
                  const col = progressColor(p.progress);
                  return html`<a
                    class="pill"
                    href="/cases?theme=${encodeURIComponent(theme)}&progress=${encodeURIComponent(p.progress)}"
                    ><span class="prog-dot" style="background:${col}" aria-hidden="true"></span>${p.progress}<span
                      class="pill-count"
                      >${p.cases}</span
                    ></a
                  >`;
                })}
              </div>`
          : html`<p class="muted small mb-0">データがありません。</p>`}
      </section>

      <section class="card">
        <h2 class="card-title">
          <span>都道府県別の内訳（上位）</span>
          <span class="small muted">タップで絞り込み</span>
        </h2>
        ${prefs.length
          ? html`<div class="hbar-list" role="list" aria-label="都道府県別の事件件数">
              ${prefs.map((p) => {
                const w = Math.max(4, Math.round((p.cases / maxPref) * 100));
                return html`<a
                  class="hbar-row"
                  href="/cases?theme=${encodeURIComponent(theme)}&prefecture=${encodeURIComponent(p.prefecture)}"
                  role="listitem"
                >
                  <span class="hbar-label">${p.prefecture}</span>
                  <span class="hbar-count num">${p.cases.toLocaleString("ja-JP")}件</span>
                  <span class="hbar-track" aria-hidden="true">
                    <span class="hbar-fill" style="display:block;width:${w}%"></span>
                  </span>
                </a>`;
              })}
            </div>`
          : html`<p class="muted small mb-0">データがありません。</p>`}
      </section>
    </div>

    ${natData
      ? html`<section class="card mt-16">
          <h2 class="card-title">
            <span>国籍別の人数</span>
            <span class="small muted">タップで事件一覧へ</span>
          </h2>
          ${statedNats.length
            ? html`<div class="nat-list" role="list" aria-label="国籍別の積み上げ横棒グラフ">
                  ${statedNats.slice(0, 15).map((r) => {
                    const totalW = Math.max(4, (r.people / maxNat) * 100);
                    const visPct = r.people > 0 ? (r.residence["来日外国人"] / r.people) * totalW : 0;
                    const resPct = r.people > 0 ? (r.residence["定着居住者"] / r.people) * totalW : 0;
                    const unkPct = Math.max(0, totalW - visPct - resPct);
                    return html`<a
                      class="nat-row"
                      href="/cases?theme=${encodeURIComponent(theme)}&nationality=${encodeURIComponent(r.nationality)}"
                      role="listitem"
                    >
                      <span class="nat-label">${r.nationality}</span>
                      <span
                        class="nat-track"
                        title="来日外国人 ${r.residence["来日外国人"]}人 / 定着居住者 ${r.residence["定着居住者"]}人 / 不明 ${r.residence["不明"]}人"
                      >
                        ${visPct > 0
                          ? html`<span class="nat-seg" style="width:${visPct}%;background:var(--accent)"
                              >${visPct >= 10 ? r.residence["来日外国人"] : ""}</span
                            >`
                          : ""}
                        ${resPct > 0
                          ? html`<span class="nat-seg" style="width:${resPct}%;background:#38bdf8"
                              >${resPct >= 10 ? r.residence["定着居住者"] : ""}</span
                            >`
                          : ""}
                        ${unkPct > 0
                          ? html`<span class="nat-seg" style="width:${unkPct}%;background:var(--muted)"
                              >${unkPct >= 10 ? r.residence["不明"] : ""}</span
                            >`
                          : ""}
                      </span>
                      <span class="nat-count num"
                        >${r.people.toLocaleString("ja-JP")}人<span class="nat-chev" aria-hidden="true">›</span></span
                      >
                    </a>`;
                  })}
                </div>
                <div class="chart-legend mt-12" aria-hidden="true">
                  <span class="chart-legend-item"
                    ><span class="chart-dot" style="background:var(--accent)"></span>来日外国人</span
                  >
                  <span class="chart-legend-item"
                    ><span class="chart-dot" style="background:#38bdf8"></span>定着居住者</span
                  >
                  <span class="chart-legend-item"
                    ><span class="chart-dot" style="background:var(--muted)"></span>在留資格不明</span
                  >
                </div>`
            : html`<p class="muted small mb-0">国籍の記載があるデータはまだありません。</p>`}
          <p class="small muted mt-12 mb-0">
            記事に明記された国籍のみを集計しています。報道された事件にもとづく集計であり、人口あたりの補正はしていません。
          </p>
        </section>`
      : ""}

    <section class="card mt-16">
      <h2 class="card-title">
        <span>最近動きのあった事件</span>
        <a class="small" href="/cases?theme=${encodeURIComponent(theme)}">すべて見る →</a>
      </h2>
      ${cases.length
        ? html`<ul class="feed">
            ${cases.map(
              (k) => html`<li class="feed-item">
                <div class="feed-meta">
                  <span class="pill ${stageBadgeClass(k.latest_stage)}">${k.latest_stage}</span>
                  ${k.progress ? html`<span class="small muted">${k.progress}</span>` : ""}
                  <span>${k.prefecture ?? "場所不明"}</span>
                  <span class="num">${formatDateShort(k.latest_at)}</span>
                </div>
                <a class="feed-title" href="/cases/${encodeURIComponent(k.id)}">${k.title}</a>
              </li>`,
            )}
          </ul>`
        : html`<p class="muted small mb-0">このテーマに該当する事件はまだありません。</p>`}
    </section>
  `;

  return c.html(
    renderLayout({
      title: `${theme}の事件 ${summary.total_cases}件｜HANZAI Watch`,
      description: `${theme}に関する報道・判決データ（${summary.total_cases}件、うち判決${summary.with_judgment}件）。${meta.criteria}`,
      activeNav: "themes",
      canonicalPath,
      origin,
      ogImagePath: `/og/theme/${encodeURIComponent(theme)}.svg`,
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "Dataset",
        name: `HANZAI Watch — ${theme}`,
        description: meta.criteria,
        url: `${origin}${canonicalPath}`,
      },
      body,
    }),
  );
}
