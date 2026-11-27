// トップページ（/）— コンパクトなモダン Bento ダッシュボード＋直近 1 年積み上げ棒グラフ
import type { Context } from "hono";
import { html } from "hono/html";
import type { Env } from "../../env";
import {
  caseActivityBadge,
  daysAgoJst,
  formatDateShort,
  formatDemand,
  formatPct,
  formatSentence,
  stageBadgeClass,
  todayJst,
} from "../format";
import { renderLayout } from "../layout";
import { renderStackedMonthlyBarChart } from "../svg";

/** JST の今月を含む直近 12 ヶ月の YYYY-MM リスト（昇順） */
function last12Months(todayIso: string): string[] {
  const [yStr, mStr] = todayIso.split("-");
  let y = Number(yStr);
  let m = Number(mStr);
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    out.unshift(`${y}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

export async function renderHomePage(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const origin = new URL(c.req.url).origin;
  const today = todayJst();
  const weekAgo = daysAgoJst(7);
  const recentThreshold = daysAgoJst(3);
  const months12 = last12Months(today);
  const firstMonth = months12[0]!;

  const [
    kpiRes,
    monthlyReportsRes,
    monthlyJudgRes,
    topThemesRes,
    recentCasesRes,
    todayJudgRes,
    recentJudgRes,
  ] = await db.batch([
    db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM reports r JOIN cases c ON c.id = r.case_id WHERE c.status = 'published' AND substr(r.reported_at, 1, 10) >= ?) AS week_reports,
           (SELECT COUNT(*) FROM judgments j JOIN cases c ON c.id = j.case_id WHERE c.status = 'published' AND j.status = 'published' AND j.decided_on >= ?) AS week_judgments`,
      )
      .bind(weekAgo, weekAgo),
    db
      .prepare(
        `SELECT substr(r.reported_at, 1, 7) AS month, COUNT(*) AS n
         FROM reports r
         JOIN cases c ON c.id = r.case_id
         WHERE c.status = 'published' AND substr(r.reported_at, 1, 7) >= ?
         GROUP BY 1`,
      )
      .bind(firstMonth),
    db
      .prepare(
        `SELECT substr(j.decided_on, 1, 7) AS month, COUNT(*) AS n
         FROM judgments j
         JOIN cases c ON c.id = j.case_id
         WHERE c.status = 'published' AND j.status = 'published' AND substr(j.decided_on, 1, 7) >= ?
         GROUP BY 1`,
      )
      .bind(firstMonth),
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
                (SELECT group_concat(DISTINCT ct.theme) FROM case_themes ct WHERE ct.case_id = c.id) AS themes,
                ((SELECT COUNT(*) FROM reports r WHERE r.case_id = c.id)
                  + (SELECT COUNT(*) FROM judgments j WHERE j.case_id = c.id AND j.status = 'published')) AS entry_count
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
                j.position_in_range, j.ratio_to_demand, co.name AS court_name
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
                j.position_in_range, j.ratio_to_demand, co.name AS court_name
         FROM judgments j
         JOIN cases c ON c.id = j.case_id
         JOIN courts co ON co.id = j.court_id
         WHERE c.status = 'published' AND j.status = 'published'
         ORDER BY j.decided_on DESC, j.created_at DESC
         LIMIT 4`,
      ),
  ]);

  const kpi = (kpiRes?.results?.[0] ?? { week_reports: 0, week_judgments: 0 }) as {
    week_reports: number;
    week_judgments: number;
  };

  const reportMonthMap = new Map(
    ((monthlyReportsRes?.results ?? []) as { month: string; n: number }[]).map((r) => [r.month, Number(r.n)]),
  );
  const judgMonthMap = new Map(
    ((monthlyJudgRes?.results ?? []) as { month: string; n: number }[]).map((r) => [r.month, Number(r.n)]),
  );
  const stackedSeries = months12.map((month) => ({
    month,
    cases: reportMonthMap.get(month) ?? 0,
    judgments: judgMonthMap.get(month) ?? 0,
  }));
  const stackedChart = renderStackedMonthlyBarChart(stackedSeries);

  let topThemes = (topThemesRes?.results ?? []) as { theme: string; n: number }[];
  if (topThemes.length === 0) {
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
  const maxThemeCount = Math.max(1, ...topThemes.map((t) => t.n));

  type CaseRow = {
    id: string;
    title: string;
    prefecture: string | null;
    latest_stage: string;
    progress: string | null;
    latest_at: string;
    occurred_on: string | null;
    themes: string | null;
    entry_count: number;
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
    ratio_to_demand: number | null;
    court_name: string;
  };
  const todayJudgments = (todayJudgRes?.results ?? []) as JudgRow[];
  const shownJudgments = todayJudgments.length > 0 ? todayJudgments : ((recentJudgRes?.results ?? []) as JudgRow[]);
  const judgmentHeading = todayJudgments.length > 0 ? `今日の判決（${formatDateShort(today)}）` : "最近の判決";

  const body = html`
    ${stackedChart
      ? html`<section class="card" style="margin-bottom:14px">
          <h2 class="card-title">
            <span>直近 1 年の犯罪・判決件数推移</span>
            <span class="chart-legend" aria-hidden="true">
              <span class="chart-legend-item"><span class="chart-dot" style="background:var(--accent)"></span>犯罪報道</span>
              <span class="chart-legend-item"><span class="chart-dot" style="background:#38bdf8"></span>判決</span>
            </span>
          </h2>
          ${stackedChart}
        </section>`
      : ""}

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
          <div class="quick-desc">条文・法定刑と量刑分布</div>
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
          <div class="quick-title">統計</div>
          <div class="quick-desc">クロス集計と属性別内訳</div>
        </div>
      </a>
      <a class="quick-tile" href="/themes/${encodeURIComponent("外国人犯罪")}">
        <div class="quick-tile-top">
          <span class="quick-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="2" y1="12" x2="22" y2="12"></line>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
            </svg>
          </span>
          <span class="kpi-arrow" aria-hidden="true">→</span>
        </div>
        <div>
          <div class="quick-title">外国人犯罪</div>
          <div class="quick-desc">国籍別集計と該当事件</div>
        </div>
      </a>
    </section>

    <section class="card">
      <h2 class="card-title">
        <span>件数の多いテーマ（直近 7 日）</span>
        <a class="small" href="/themes">一覧 →</a>
      </h2>
      ${topThemes.length
        ? html`<div class="bar-grid">
            ${topThemes.map((t) => {
              const pct = Math.max(6, Math.round((t.n / maxThemeCount) * 100));
              return html`<a class="bar-card" href="/themes/${encodeURIComponent(t.theme)}">
                <div class="bar-card-head">
                  <span class="bar-card-label">${t.theme}</span>
                  <span class="bar-card-val num">${t.n}<span class="small muted">件</span></span>
                </div>
                <div class="bar-track" aria-hidden="true">
                  <div class="bar-fill" style="width:${pct}%"></div>
                </div>
              </a>`;
            })}
          </div>`
        : html`<p class="muted small mb-0">まだ記録されたテーマがありません。</p>`}
    </section>

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
                const act = caseActivityBadge(k.entry_count, k.latest_at, recentThreshold);
                return html`<li class="feed-item">
                  <div class="feed-meta">
                    <span class="pill ${stageBadgeClass(k.latest_stage)}">${k.latest_stage}</span>
                    ${act.kind === "new"
                      ? html`<span class="badge-new">${act.label}</span>`
                      : act.kind === "update"
                        ? html`<span class="badge-update">${act.label}</span>`
                        : ""}
                    ${k.progress ? html`<span class="small muted">${k.progress}</span>` : ""}
                    <span>${k.prefecture ?? "場所不明"}</span>
                    <span class="num">${act.datePrefix} ${formatDateShort(k.latest_at)}</span>
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
                const dem = formatDemand(j);
                const isCustodial = j.sentence_type === "拘禁刑" || j.sentence_type === "懲役" || j.sentence_type === "禁錮";
                const execBadge = isCustodial ? (j.suspended_months != null ? "執行猶予" : "実刑") : null;
                return html`<li class="feed-item">
                  <div class="feed-meta">
                    ${execBadge ? html`<span class="pill ${j.suspended_months != null ? "" : "pill-accent"}">${execBadge}</span>` : ""}
                    <span>${j.court_name}</span>
                    <span class="num">${formatDateShort(j.decided_on)}</span>
                  </div>
                  <a class="feed-title" href="/cases/${encodeURIComponent(j.case_id)}">${formatSentence(j)}</a>
                  ${dem
                    ? html`<div class="small muted num">
                        求刑 ${dem}${j.ratio_to_demand != null ? `（求刑の ${formatPct(j.ratio_to_demand)}）` : ""}
                      </div>`
                    : ""}
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
      title: "HANZAI Watch — 日本の犯罪報道・判決データアーカイブ",
      activeNav: "home",
      canonicalPath: "/",
      origin,
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: "HANZAI Watch",
        url: origin,
        description: "日本国内の犯罪報道と判決（量刑・裁判所・担当裁判官）を事実のみに基づいて記録・公開するデータアーカイブ。",
      },
      body,
    }),
  );
}
