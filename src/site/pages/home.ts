// トップページ（/）— コンパクトなモダン Bento ダッシュボード
import type { Context } from "hono";
import { html } from "hono/html";
import type { Env } from "../../env";
import { daysAgoJst, formatDateShort, formatDemand, formatSentence, todayJst } from "../format";
import { renderLayout } from "../layout";
import { renderMiniSentencingBar } from "../svg";

export async function renderHomePage(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const origin = new URL(c.req.url).origin;
  const today = todayJst();
  const weekAgo = daysAgoJst(7);

  const [kpiRes, topThemesRes, recentCasesRes, todayJudgRes, recentJudgRes, groupsRes] = await db.batch([
    db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM reports r JOIN cases c ON c.id = r.case_id WHERE c.status = 'published' AND substr(r.reported_at, 1, 10) >= ?) AS week_reports,
           (SELECT COUNT(*) FROM judgments j JOIN cases c ON c.id = j.case_id WHERE c.status = 'published' AND j.status = 'published' AND j.decided_on >= ?) AS week_judgments`,
      )
      .bind(weekAgo, weekAgo),
    db
      .prepare(
        `SELECT ct.theme, COUNT(DISTINCT c.id) AS n
         FROM case_themes ct
         JOIN cases c ON c.id = ct.case_id
         WHERE c.status = 'published' AND substr(c.latest_at, 1, 10) >= ?
         GROUP BY ct.theme
         ORDER BY n DESC, ct.theme ASC
         LIMIT 6`,
      )
      .bind(weekAgo),
    db
      .prepare(
        `SELECT c.id, c.title, c.prefecture, c.latest_stage, c.progress, c.latest_at, c.occurred_on,
                (SELECT group_concat(DISTINCT ct.theme) FROM case_themes ct WHERE ct.case_id = c.id) AS themes
         FROM cases c
         WHERE c.status = 'published'
         ORDER BY c.latest_at DESC
         LIMIT 4`,
      ),
    db
      .prepare(
        `SELECT j.id, j.case_id, j.title, j.decided_on, j.sentence_type, j.term_months,
                j.indeterminate_min_months, j.indeterminate_max_months, j.suspended_months, j.probation,
                j.fine_yen, j.protective_disposition, j.demand_type, j.demand_months, j.demand_fine_yen,
                j.position_in_range, co.name AS court_name
         FROM judgments j
         JOIN cases c ON c.id = j.case_id
         JOIN courts co ON co.id = j.court_id
         WHERE c.status = 'published' AND j.status = 'published' AND j.decided_on = ?
         ORDER BY j.created_at DESC
         LIMIT 4`,
      )
      .bind(today),
    db
      .prepare(
        `SELECT j.id, j.case_id, j.title, j.decided_on, j.sentence_type, j.term_months,
                j.indeterminate_min_months, j.indeterminate_max_months, j.suspended_months, j.probation,
                j.fine_yen, j.protective_disposition, j.demand_type, j.demand_months, j.demand_fine_yen,
                j.position_in_range, co.name AS court_name
         FROM judgments j
         JOIN cases c ON c.id = j.case_id
         JOIN courts co ON co.id = j.court_id
         WHERE c.status = 'published' AND j.status = 'published'
         ORDER BY j.decided_on DESC, j.created_at DESC
         LIMIT 4`,
      ),
    db.prepare(
      `WITH case_laws AS (
         SELECT r.case_id, rc.law_code FROM report_charges rc JOIN reports r ON r.id = rc.report_id WHERE rc.law_code IS NOT NULL
         UNION
         SELECT j.case_id, jc.law_code FROM judgment_charges jc JOIN judgments j ON j.id = jc.judgment_id WHERE jc.law_code IS NOT NULL AND j.status = 'published'
       )
       SELECT l.category, l.group_name, COUNT(DISTINCT c.id) AS cases
       FROM cases c
       JOIN case_laws cl ON cl.case_id = c.id
       JOIN laws l ON l.code = cl.law_code
       WHERE c.status = 'published'
       GROUP BY l.category, l.group_name
       ORDER BY cases DESC, l.group_name ASC
       LIMIT 8`,
    ),
  ]);

  const kpi = (kpiRes?.results?.[0] ?? { week_reports: 0, week_judgments: 0 }) as {
    week_reports: number;
    week_judgments: number;
  };
  let topThemes = (topThemesRes?.results ?? []) as { theme: string; n: number }[];
  if (topThemes.length === 0) {
    // 直近 7 日にデータがなければ全期間の上位 6 テーマを表示
    const fallback = await db
      .prepare(
        `SELECT ct.theme, COUNT(DISTINCT c.id) AS n
         FROM case_themes ct JOIN cases c ON c.id = ct.case_id
         WHERE c.status = 'published'
         GROUP BY ct.theme ORDER BY n DESC, ct.theme ASC LIMIT 6`,
      )
      .all<{ theme: string; n: number }>();
    topThemes = fallback.results;
  }

  type CaseRow = {
    id: string;
    title: string;
    prefecture: string | null;
    latest_stage: string;
    progress: string | null;
    latest_at: string;
    occurred_on: string | null;
    themes: string | null;
  };
  const recentCases = (recentCasesRes?.results ?? []) as CaseRow[];

  type JudgRow = {
    id: string;
    case_id: string;
    title: string;
    decided_on: string;
    sentence_type: string;
    term_months: number | null;
    indeterminate_min_months: number | null;
    indeterminate_max_months: number | null;
    suspended_months: number | null;
    probation: number | null;
    fine_yen: number | null;
    protective_disposition: string | null;
    demand_type: string | null;
    demand_months: number | null;
    demand_fine_yen: number | null;
    position_in_range: number | null;
    court_name: string;
  };
  const todayJudgments = (todayJudgRes?.results ?? []) as JudgRow[];
  const shownJudgments = todayJudgments.length > 0 ? todayJudgments : ((recentJudgRes?.results ?? []) as JudgRow[]);
  const judgmentHeading = todayJudgments.length > 0 ? `今日の判決（${formatDateShort(today)}）` : "最近の判決";

  const groups = (groupsRes?.results ?? []) as { category: string; group_name: string; cases: number }[];

  const body = html`
    <section class="bento-kpi-2" aria-label="今週のサマリー">
      <a class="kpi-card" href="/cases?from=${encodeURIComponent(weekAgo)}">
        <div class="kpi-head">
          <span class="kpi-label">今週の報道</span>
          <span class="kpi-arrow" aria-hidden="true">→</span>
        </div>
        <div class="kpi-value num">${kpi.week_reports.toLocaleString("ja-JP")}<span class="kpi-unit">件</span></div>
      </a>
      <a class="kpi-card" href="/cases?has_judgment=1&from=${encodeURIComponent(weekAgo)}">
        <div class="kpi-head">
          <span class="kpi-label">今週の判決</span>
          <span class="kpi-arrow" aria-hidden="true">→</span>
        </div>
        <div class="kpi-value num">${kpi.week_judgments.toLocaleString("ja-JP")}<span class="kpi-unit">件</span></div>
      </a>
    </section>
    <p class="small muted" style="margin: -4px 2px 14px;">
      ※ 収集した報道・判決にもとづく件数であり、全国の全発生件数ではありません。
    </p>

    <section class="quick-grid" aria-label="メニューショートカット">
      <a class="quick-tile" href="/prefectures">
        <div class="quick-tile-top">
          <span class="quick-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"></polygon>
              <line x1="9" y1="3" x2="9" y2="18"></line><line x1="15" y1="6" x2="15" y2="21"></line>
            </svg>
          </span>
          <span class="kpi-arrow" aria-hidden="true">→</span>
        </div>
        <div>
          <div class="quick-title">都道府県マップ</div>
          <div class="quick-desc">地図・一覧から地域別に探す</div>
        </div>
      </a>
      <a class="quick-tile" href="/cases">
        <div class="quick-tile-top">
          <span class="quick-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line>
            </svg>
          </span>
          <span class="kpi-arrow" aria-hidden="true">→</span>
        </div>
        <div>
          <div class="quick-title">事件一覧</div>
          <div class="quick-desc">条件・キーワードで絞り込む</div>
        </div>
      </a>
      <a class="quick-tile" href="/themes">
        <div class="quick-tile-top">
          <span class="quick-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
              <line x1="7" y1="7" x2="7.01" y2="7"></line>
            </svg>
          </span>
          <span class="kpi-arrow" aria-hidden="true">→</span>
        </div>
        <div>
          <div class="quick-title">テーマ別</div>
          <div class="quick-desc">詐欺・交通・判決など切り口別</div>
        </div>
      </a>
      <a class="quick-tile" href="/laws">
        <div class="quick-tile-top">
          <span class="quick-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m12 3-7 4v5c0 5 3.5 7.5 7 9 3.5-1.5 7-4 7-9V7l-7-4z"></path>
            </svg>
          </span>
          <span class="kpi-arrow" aria-hidden="true">→</span>
        </div>
        <div>
          <div class="quick-title">法律・量刑</div>
          <div class="quick-desc">法定刑と量刑分布を比較</div>
        </div>
      </a>
      <a class="quick-tile" href="/stats">
        <div class="quick-tile-top">
          <span class="quick-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line>
            </svg>
          </span>
          <span class="kpi-arrow" aria-hidden="true">→</span>
        </div>
        <div>
          <div class="quick-title">統計・CSV</div>
          <div class="quick-desc">クロス集計と属性別内訳</div>
        </div>
      </a>
    </section>

    <div class="bento-equal" style="margin-top:0">
      <section class="card">
        <h2 class="card-title">
          <span>件数の多いテーマ（直近 7 日）</span>
          <a class="small" href="/themes">一覧 →</a>
        </h2>
        ${topThemes.length
          ? html`<div class="pills">
              ${topThemes.map(
                (t) =>
                  html`<a class="pill" href="/themes/${encodeURIComponent(t.theme)}"
                    >${t.theme}<span class="pill-count">${t.n}</span></a
                  >`,
              )}
            </div>`
          : html`<p class="muted small mb-0">まだ記録されたテーマがありません。</p>`}
      </section>

      <section class="card">
        <h2 class="card-title">
          <span>法律の分類（上位）</span>
          <a class="small" href="/laws">法律一覧 →</a>
        </h2>
        ${groups.length
          ? html`<div class="pills">
              ${groups.map(
                (g) => html`<a class="pill" href="/cases?group=${encodeURIComponent(g.group_name)}"
                  >${g.group_name}<span class="pill-count">${g.cases}</span></a
                >`,
              )}
            </div>`
          : html`<p class="muted small mb-0">まだ分類された事件がありません。</p>`}
      </section>
    </div>

    <div class="bento-2col">
      <section class="card">
        <h2 class="card-title">
          <span>最近動きのあった事件</span>
          <a class="small" href="/cases">すべて見る →</a>
        </h2>
        ${recentCases.length
          ? html`<ul class="feed">
              ${recentCases.map((k) => {
                const themes = k.themes ? k.themes.split(",").slice(0, 2) : [];
                return html`<li class="feed-item">
                  <div class="feed-meta">
                    <span class="pill pill-accent">${k.latest_stage}</span>
                    ${k.progress ? html`<span class="small muted">${k.progress}</span>` : ""}
                    <span>${k.prefecture ?? "場所不明"}</span>
                    <span class="num">${formatDateShort(k.latest_at)}</span>
                  </div>
                  <a class="feed-title" href="/cases/${encodeURIComponent(k.id)}">${k.title}</a>
                  ${themes.length
                    ? html`<div class="pills mt-8">
                        ${themes.map(
                          (th) => html`<a class="pill" href="/themes/${encodeURIComponent(th)}">${th}</a>`,
                        )}
                      </div>`
                    : ""}
                </li>`;
              })}
            </ul>`
          : html`<p class="muted small mb-0">まだ公開された事件がありません。</p>`}
      </section>

      <section class="card">
        <h2 class="card-title">
          <span>${judgmentHeading}</span>
          <a class="small" href="/cases?has_judgment=1">判決あり →</a>
        </h2>
        ${shownJudgments.length
          ? html`<ul class="feed">
              ${shownJudgments.map((j) => {
                const mini = renderMiniSentencingBar(j.position_in_range, j.suspended_months != null);
                const dem = formatDemand(j);
                return html`<li class="feed-item">
                  <div class="feed-meta">
                    <span>${j.court_name}</span>
                    <span class="num">${formatDateShort(j.decided_on)}</span>
                  </div>
                  <a class="feed-title" href="/cases/${encodeURIComponent(j.case_id)}">${formatSentence(j)}</a>
                  ${dem ? html`<div class="small muted">求刑: ${dem}</div>` : ""}
                  ${mini ? html`<div class="mt-8">${mini}</div>` : ""}
                  <div class="small muted">${j.title}</div>
                </li>`;
              })}
            </ul>`
          : html`<p class="muted small mb-0">まだ公開された判決がありません。</p>`}
      </section>
    </div>
  `;

  return c.html(
    renderLayout({
      title: "Crime Watch — 日本の犯罪報道・判決データアーカイブ",
      activeNav: "home",
      canonicalPath: "/",
      origin,
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: "Crime Watch",
        url: origin,
        description: "日本国内の犯罪報道と判決（量刑・裁判所・担当裁判官）を事実のみに基づいて記録・公開するデータアーカイブ。",
      },
      body,
    }),
  );
}
