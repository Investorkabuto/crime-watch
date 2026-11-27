// 都道府県一覧（/prefectures）と 都道府県別ページ（/prefectures/:name）
import type { Context } from "hono";
import { html } from "hono/html";
import type { Env } from "../../env";
import { PREF_EXPR, prefectureStats, type PrefBasis } from "../../prefstats";
import { PREFECTURES } from "../../schema";
import { formatDateShort, formatPct } from "../format";
import { renderLayout } from "../layout";
import { per100k, POPULATION_SOURCE_LABEL, POPULATION_SOURCE_URL } from "../population";

const PREF_SET = new Set<string>([...PREFECTURES, "不明"]);
const BASIS_LABELS: Record<PrefBasis, string> = {
  occurrence: "発生地ベース",
  police: "捜査警察ベース",
  court: "裁判所ベース",
};

function parseBasis(raw: string | undefined): PrefBasis {
  return raw && raw in PREF_EXPR ? (raw as PrefBasis) : "occurrence";
}

/** 都道府県一覧 /prefectures */
export async function renderPrefecturesListPage(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const origin = new URL(c.req.url).origin;
  const basis = parseBasis(c.req.query("basis"));
  const stats = await prefectureStats(db, { basis });

  const body = html`
    <h1 class="page-h1">都道府県別一覧</h1>
    <p class="page-lead">
      都道府県ごとの事件数・人口 10 万人あたり件数・判決数を一覧できます（合計 <strong class="num">${stats.total_cases.toLocaleString("ja-JP")}</strong> 件）。
    </p>

    <section class="card">
      <div class="pills" style="margin-bottom:12px">
        ${(["occurrence", "police", "court"] as PrefBasis[]).map(
          (b) => html`<a
            class="pill ${basis === b ? "pill-accent" : ""}"
            href="/prefectures?basis=${b}"
            >${BASIS_LABELS[b]}</a
          >`,
        )}
      </div>
      <div class="note-box" style="margin-bottom:14px">
        件数は収集した報道・判決にもとづくものであり、警察庁の認知件数ではありません。
        人口 10 万人あたり件数は
        <a href="${POPULATION_SOURCE_URL}" target="_blank" rel="noopener noreferrer">${POPULATION_SOURCE_LABEL}</a>
        にもとづいて算出しています。
      </div>
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
          <tbody>
            ${stats.prefectures.map((r) => {
              const rate = per100k(r.cases, r.prefecture);
              return html`<tr>
                <td>
                  <a href="/prefectures/${encodeURIComponent(r.prefecture)}?basis=${basis}" style="font-weight:600"
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
  `;

  return c.html(
    renderLayout({
      title: "都道府県別一覧｜Crime Watch",
      description: "47 都道府県ごとの犯罪報道・判決件数と人口 10 万人あたり件数の一覧。",
      activeNav: "prefectures",
      canonicalPath: "/prefectures",
      origin,
      body,
    }),
  );
}

/** 都道府県別ページ /prefectures/:name */
export async function renderPrefectureDetailPage(c: Context<{ Bindings: Env }>) {
  const name = decodeURIComponent(c.req.param("name") ?? "");
  const origin = new URL(c.req.url).origin;

  if (!PREF_SET.has(name)) {
    return c.html(
      renderLayout({
        title: "都道府県が見つかりません｜Crime Watch",
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
  const basis = parseBasis(c.req.query("basis"));
  const prefCond = name === "不明" ? `${PREF_EXPR[basis]} IS NULL` : `${PREF_EXPR[basis]} = ?`;
  const binds = name === "不明" ? [] : [name];

  const [countRes, lawsRes, themesRes, citiesRes, casesRes] = await db.batch([
    db
      .prepare(
        `SELECT COUNT(*) AS cases,
                SUM(CASE WHEN EXISTS (SELECT 1 FROM judgments j WHERE j.case_id = c.id AND j.status = 'published') THEN 1 ELSE 0 END) AS with_judgment
         FROM cases c WHERE c.status = 'published' AND ${prefCond}`,
      )
      .bind(...binds),
    db
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
    db
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
    <section class="card">
      <div class="pills" style="margin-bottom:8px">
        <a class="pill" href="/prefectures?basis=${basis}">都道府県一覧</a>
        ${(["occurrence", "police", "court"] as PrefBasis[]).map(
          (b) => html`<a
            class="pill ${basis === b ? "pill-accent" : ""}"
            href="${canonicalPath}?basis=${b}"
            >${BASIS_LABELS[b]}</a
          >`,
        )}
      </div>
      <h1 class="page-h1">${name}の事件・判決</h1>
      <p class="small muted mb-0">
        報道された事件にもとづく集計です。人口 10 万人あたり件数は
        <a href="${POPULATION_SOURCE_URL}" target="_blank" rel="noopener noreferrer">${POPULATION_SOURCE_LABEL}</a>
        にもとづいて算出しています。
      </p>
    </section>

    <section class="bento-kpi mt-16">
      <div class="kpi-card">
        <div class="kpi-label">事件数（${BASIS_LABELS[basis]}）</div>
        <div class="kpi-value num">${counts.cases.toLocaleString("ja-JP")}<span class="kpi-unit">件</span></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">人口 10 万人あたり</div>
        <div class="kpi-value num">${rate != null ? rate.toFixed(2) : "—"}<span class="kpi-unit">${rate != null ? "件" : ""}</span></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">うち判決あり</div>
        <div class="kpi-value num">${(counts.with_judgment ?? 0).toLocaleString("ja-JP")}<span class="kpi-unit">件</span></div>
      </div>
    </section>

    <div class="bento-equal">
      <section class="card">
        <h2 class="card-title">法律別の内訳</h2>
        ${laws.length
          ? html`<div class="pills">
              ${laws.map(
                (l) => html`<a class="pill" href="/laws/${encodeURIComponent(l.code)}"
                  >${l.name}<span class="pill-count">${l.cases}</span></a
                >`,
              )}
            </div>`
          : html`<p class="muted small mb-0">データがありません。</p>`}
      </section>
      <section class="card">
        <h2 class="card-title">テーマ別の内訳</h2>
        ${themes.length
          ? html`<div class="pills">
              ${themes.map(
                (t) => html`<a class="pill" href="/themes/${encodeURIComponent(t.theme)}"
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
            ${cities.map((ct) => html`<span class="pill">${ct.city}<span class="pill-count">${ct.cases}</span></span>`)}
          </div>
        </section>`
      : ""}

    <section class="card mt-16">
      <h2 class="card-title">
        <span>最近の事件</span>
        <a class="small" href="/cases?prefecture=${encodeURIComponent(name)}&pref_basis=${basis}">すべて見る →</a>
      </h2>
      ${cases.length
        ? html`<ul class="feed">
            ${cases.map(
              (k) => html`<li class="feed-item">
                <div class="feed-meta">
                  <span class="pill pill-accent">${k.latest_stage}</span>
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
      title: `${name}の事件・判決（${counts.cases}件）｜Crime Watch`,
      description: `${name}で報道された事件・判決の集計と一覧（${BASIS_LABELS[basis]}）。`,
      activeNav: "prefectures",
      canonicalPath,
      origin,
      body,
    }),
  );
}
