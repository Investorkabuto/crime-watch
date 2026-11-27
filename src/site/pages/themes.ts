// テーマ一覧（/themes）と テーマ別ページ（/themes/:theme）
import type { Context } from "hono";
import { html } from "hono/html";
import type { Env } from "../../env";
import { nationalityStats } from "../../natstats";
import { THEMES, type Theme } from "../../themes";
import { formatDateShort, THEME_GROUPS, THEME_META } from "../format";
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
        <div class="bento-3col">
          ${items.map((t) => {
            const n = countMap.get(t) ?? 0;
            return html`<a
              class="card"
              style="padding:14px 16px;margin:0;text-decoration:none;color:inherit;display:flex;flex-direction:column;gap:6px"
              href="/themes/${encodeURIComponent(t)}"
            >
              <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
                <strong style="font-size:15px">${t}</strong>
                <span class="num" style="font-size:18px;font-weight:800">${n}<span class="small muted">件</span></span>
              </div>
              <div class="small muted">${THEME_META[t].criteria}</div>
            </a>`;
          })}
        </div>
      </section>`;
    })}
  `;

  return c.html(
    renderLayout({
      title: "テーマ一覧｜Crime Watch",
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
        title: "テーマが見つかりません｜Crime Watch",
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

  const chart = renderMonthlyBarChart(monthly.slice(-12));
  const canonicalPath = `/themes/${encodeURIComponent(theme)}`;

  const body = html`
    <section class="card">
      <div class="pills" style="margin-bottom:8px">
        <a class="pill" href="/themes">テーマ一覧</a>
        <span class="pill">${meta.group}</span>
      </div>
      <h1 class="page-h1">${theme}</h1>
      <p class="page-lead mb-0">${meta.criteria}</p>
    </section>

    <section class="bento-kpi mt-16">
      <div class="kpi-card">
        <div class="kpi-label">記録された事件数</div>
        <div class="kpi-value num">${summary.total_cases.toLocaleString("ja-JP")}<span class="kpi-unit">件</span></div>
        <div class="kpi-sub">報道された事件の件数</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">うち判決あり</div>
        <div class="kpi-value num">${summary.with_judgment.toLocaleString("ja-JP")}<span class="kpi-unit">件</span></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">配信</div>
        <div style="margin-top:6px">
          <a class="btn" href="/themes/${encodeURIComponent(theme)}/feed.xml">このテーマの RSS</a>
        </div>
      </div>
    </section>

    ${chart
      ? html`<section class="card">
          <h2 class="card-title">月ごとの件数推移</h2>
          ${chart}
        </section>`
      : ""}

    <div class="bento-equal">
      <section class="card">
        <h2 class="card-title">都道府県別の内訳（上位）</h2>
        ${prefs.length
          ? html`<div class="pills">
              ${prefs.map(
                (p) => html`<a
                  class="pill"
                  href="/cases?theme=${encodeURIComponent(theme)}&prefecture=${encodeURIComponent(p.prefecture)}"
                  >${p.prefecture}<span class="pill-count">${p.cases}</span></a
                >`,
              )}
            </div>`
          : html`<p class="muted small mb-0">データがありません。</p>`}
      </section>
      <section class="card">
        <h2 class="card-title">進み具合の内訳</h2>
        ${progs.length
          ? html`<div class="pills">
              ${progs.map(
                (p) => html`<a
                  class="pill"
                  href="/cases?theme=${encodeURIComponent(theme)}&progress=${encodeURIComponent(p.progress)}"
                  >${p.progress}<span class="pill-count">${p.cases}</span></a
                >`,
              )}
            </div>`
          : html`<p class="muted small mb-0">データがありません。</p>`}
      </section>
    </div>

    ${natData
      ? html`<section class="card mt-16">
          <h2 class="card-title">国籍別の人数（人単位）</h2>
          <p class="small muted" style="margin:-6px 0 12px">
            記事に明記された国籍のみを集計しています。「記載なし」は日本国籍とはみなしません。報道された事件にもとづく集計であり、人口あたりの補正はしていません。
          </p>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>国籍</th>
                  <th class="num">人数</th>
                  <th class="num">事件数</th>
                  <th class="num">来日外国人</th>
                  <th class="num">定着居住者</th>
                </tr>
              </thead>
              <tbody>
                ${natData.nationalities.slice(0, 15).map(
                  (r) => html`<tr>
                    <td>${r.nationality}</td>
                    <td class="num">${r.people}</td>
                    <td class="num">${r.cases}</td>
                    <td class="num">${r.residence["来日外国人"]}</td>
                    <td class="num">${r.residence["定着居住者"]}</td>
                  </tr>`,
                )}
              </tbody>
            </table>
          </div>
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
                  <span class="pill pill-accent">${k.latest_stage}</span>
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
      title: `${theme}の事件 ${summary.total_cases}件｜Crime Watch`,
      description: `${theme}に関する報道・判決データ（${summary.total_cases}件、うち判決${summary.with_judgment}件）。${meta.criteria}`,
      activeNav: "themes",
      canonicalPath,
      origin,
      ogImagePath: `/og/theme/${encodeURIComponent(theme)}.svg`,
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "Dataset",
        name: `Crime Watch — ${theme}`,
        description: meta.criteria,
        url: `${origin}${canonicalPath}`,
      },
      body,
    }),
  );
}
