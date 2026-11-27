// 法律一覧（/laws）と 法律別ページ（/laws/:code）
import type { Context } from "hono";
import { html, raw } from "hono/html";
import type { Env } from "../../env";
import { formatMonths } from "../../normalize";
import { ci95, formatDateJa, formatDateShort, formatGender, formatPct, stageBadgeClass } from "../format";
import { LAW_TEXTS } from "../law-texts";
import { renderLayout } from "../layout";
import { renderMonthlyBarChart, renderSentencingDistributionChart } from "../svg";

const MIN_METRIC_N = 20;

/** 法律一覧 /laws */
export async function renderLawsListPage(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const origin = new URL(c.req.url).origin;
  const activeCat = c.req.query("category") === "特別法犯" ? "特別法犯" : "刑法犯";

  const [lawsRes, periodsRes, countsRes] = await db.batch([
    db.prepare("SELECT code, name, law_name, category, group_name, sort_order FROM laws ORDER BY sort_order"),
    db.prepare(
      `SELECT law_code, statutory_penalty, verified FROM law_penalty_periods
       WHERE effective_to IS NULL`,
    ),
    db.prepare(
      `WITH case_laws AS (
         SELECT r.case_id, rc.law_code FROM report_charges rc JOIN reports r ON r.id = rc.report_id WHERE rc.law_code IS NOT NULL
         UNION
         SELECT j.case_id, jc.law_code FROM judgment_charges jc JOIN judgments j ON j.id = jc.judgment_id WHERE jc.law_code IS NOT NULL AND j.status = 'published'
       )
       SELECT cl.law_code, COUNT(DISTINCT c.id) AS cases
       FROM case_laws cl JOIN cases c ON c.id = cl.case_id
       WHERE c.status = 'published'
       GROUP BY cl.law_code`,
    ),
  ]);

  type LawRow = { code: string; name: string; law_name: string; category: string; group_name: string };
  const laws = (lawsRes?.results ?? []) as LawRow[];
  const periodMap = new Map(
    ((periodsRes?.results ?? []) as { law_code: string; statutory_penalty: string; verified: number }[]).map((p) => [
      p.law_code,
      p,
    ]),
  );
  const countMap = new Map(
    ((countsRes?.results ?? []) as { law_code: string; cases: number }[]).map((r) => [r.law_code, r.cases]),
  );

  const categories = ["刑法犯", "特別法犯"] as const;
  const tabScript = `
(() => {
  const btns = document.querySelectorAll("[data-law-tab]");
  const panels = document.querySelectorAll("[data-law-panel]");
  const activate = (target, persist) => {
    btns.forEach((b) => b.classList.toggle("is-active", b.dataset.lawTab === target));
    panels.forEach((p) => { p.style.display = p.dataset.lawPanel === target ? "" : "none"; });
    if (persist) {
      try { sessionStorage.setItem("cw_law_cat", target); } catch {}
    }
  };
  const restore = () => {
    try {
      const saved = sessionStorage.getItem("cw_law_cat");
      if (saved === "刑法犯" || saved === "特別法犯") activate(saved, false);
    } catch {}
  };
  btns.forEach((btn) => {
    btn.addEventListener("click", () => activate(btn.dataset.lawTab, true));
  });
  restore();
  window.addEventListener("pageshow", restore);
})();
`;

  const body = html`
    <h1 class="page-h1">法律一覧</h1>
    <p class="page-lead">
      罪状ごとに条文・わかりやすい要約・法定刑・事件数を確認できます。
    </p>

    <div style="margin-bottom:14px">
      <div class="segmented" role="tablist" aria-label="法律の区分">
        ${categories.map((cat) => {
          const catCount = laws.filter((l) => l.category === cat).length;
          return html`<button
            type="button"
            class="${activeCat === cat ? "is-active" : ""}"
            data-law-tab="${cat}"
          >${cat}（${catCount}）</button>`;
        })}
      </div>
    </div>

    ${categories.map((cat) => {
      const catLaws = laws.filter((l) => l.category === cat);
      const groups = [...new Set(catLaws.map((l) => l.group_name))];
      return html`<div data-law-panel="${cat}" style="${activeCat === cat ? "" : "display:none"}">
        ${groups.map((grp) => {
          const items = catLaws.filter((l) => l.group_name === grp);
          return html`<section class="card">
            <h2 class="card-title">${grp}</h2>
            <div class="compact-grid">
              ${items.map((l) => {
                const p = periodMap.get(l.code);
                const n = countMap.get(l.code) ?? 0;
                return html`<a class="compact-card" href="/laws/${encodeURIComponent(l.code)}">
                  <div class="compact-card-head">
                    <span class="compact-card-title">${l.name}</span>
                    <span class="compact-card-count num">${n}<span class="small muted">件</span></span>
                  </div>
                  <div class="compact-card-desc">${l.law_name}${p ? ` · ${p.statutory_penalty}` : ""}</div>
                </a>`;
              })}
            </div>
          </section>`;
        })}
      </div>`;
    })}

    <script>
      ${raw(tabScript)}
    </script>
  `;

  return c.html(
    renderLayout({
      title: "法律一覧｜HANZAI Watch",
      description: "刑法犯・特別法犯の法律ごとの条文・要約・法定刑・事件数を一覧できます。",
      activeNav: "laws",
      canonicalPath: "/laws",
      origin,
      body,
    }),
  );
}

/** 法律別ページ /laws/:code */
export async function renderLawDetailPage(c: Context<{ Bindings: Env }>) {
  const code = c.req.param("code");
  const db = c.env.DB;
  const origin = new URL(c.req.url).origin;

  const law = await db
    .prepare("SELECT code, name, law_name, category, group_name FROM laws WHERE code = ?")
    .bind(code)
    .first<{ code: string; name: string; law_name: string; category: string; group_name: string }>();

  if (!law) {
    return c.html(
      renderLayout({
        title: "法律が見つかりません｜HANZAI Watch",
        activeNav: "laws",
        origin,
        noindex: true,
        body: html`<section class="card">
          <h1 class="page-h1">法律が見つかりません</h1>
          <a class="btn" href="/laws">法律一覧に戻る</a>
        </section>`,
      }),
      404,
    );
  }

  const [periodsRes, monthlyRes, distRes, judgAttrRes, casesRes] = await db.batch([
    db
      .prepare(
        `SELECT effective_from, effective_to, statutory_penalty, stat_min_months, stat_max_months, verified
         FROM law_penalty_periods WHERE law_code = ? ORDER BY effective_from DESC`,
      )
      .bind(code),
    db
      .prepare(
        `WITH case_laws AS (
           SELECT r.case_id FROM report_charges rc JOIN reports r ON r.id = rc.report_id WHERE rc.law_code = ?1
           UNION
           SELECT j.case_id FROM judgment_charges jc JOIN judgments j ON j.id = jc.judgment_id WHERE jc.law_code = ?1 AND j.status = 'published'
         )
         SELECT substr(COALESCE(c.occurred_on, c.latest_at), 1, 7) AS month, COUNT(DISTINCT c.id) AS cases
         FROM cases c JOIN case_laws cl ON cl.case_id = c.id
         WHERE c.status = 'published'
         GROUP BY 1 ORDER BY 1 ASC`,
      )
      .bind(code),
    db
      .prepare("SELECT * FROM agg_sentence_dist WHERE law_code = ? AND instance = '*'")
      .bind(code),
    db
      .prepare(
        `SELECT j.defendant_gender, j.defendant_age_group, j.term_months, j.suspended_months,
                j.position_in_range, j.ratio_to_demand
         FROM judgments j JOIN cases c ON c.id = j.case_id
         WHERE c.status = 'published' AND j.status = 'published'
           AND j.primary_law_code = ?
           AND j.sentence_type IN ('拘禁刑','懲役','禁錮')
           AND j.term_months IS NOT NULL
           AND (j.juvenile_class IS NULL OR j.juvenile_class = 'adult')`,
      )
      .bind(code),
    db
      .prepare(
        `WITH case_laws AS (
           SELECT r.case_id FROM report_charges rc JOIN reports r ON r.id = rc.report_id WHERE rc.law_code = ?1
           UNION
           SELECT j.case_id FROM judgment_charges jc JOIN judgments j ON j.id = jc.judgment_id WHERE jc.law_code = ?1 AND j.status = 'published'
         )
         SELECT c.id, c.title, c.prefecture, c.latest_stage, c.progress, c.latest_at
         FROM cases c JOIN case_laws cl ON cl.case_id = c.id
         WHERE c.status = 'published'
         ORDER BY c.latest_at DESC LIMIT 20`,
      )
      .bind(code),
  ]);

  const periods = (periodsRes?.results ?? []) as {
    effective_from: string;
    effective_to: string | null;
    statutory_penalty: string;
    stat_min_months: number | null;
    stat_max_months: number | null;
    verified: number;
  }[];
  const currentPeriod = periods.find((p) => p.effective_to == null) ?? periods[0] ?? null;
  const monthly = (monthlyRes?.results ?? []) as { month: string; cases: number }[];
  const totalCases = monthly.reduce((s, r) => s + r.cases, 0);

  type JudgAttr = {
    defendant_gender: string | null;
    defendant_age_group: string | null;
    term_months: number;
    suspended_months: number | null;
    position_in_range: number | null;
    ratio_to_demand: number | null;
  };
  const judgAttrs = (judgAttrRes?.results ?? []) as JudgAttr[];

  // 集計テーブルが未実行のときもフォールバックで件数・分布を表示
  const distRow = (distRes?.results?.[0] ?? null) as {
    n: number;
    min_months: number | null;
    p25_months: number | null;
    median_months: number | null;
    p75_months: number | null;
    max_months: number | null;
    suspended_n: number;
    custodial_n: number;
    avg_ratio_to_demand: number | null;
    n_ratio_to_demand: number;
  } | null;

  const sortedTerms = judgAttrs.map((j) => j.term_months).sort((a, b) => a - b);
  const quantile = (arr: number[], qVal: number) =>
    arr.length ? arr[Math.min(arr.length - 1, Math.floor((arr.length - 1) * qVal))]! : null;
  const distChart = renderSentencingDistributionChart({
    statMinMonths: currentPeriod?.stat_min_months ?? null,
    statMaxMonths: currentPeriod?.stat_max_months ?? null,
    points: judgAttrs.map((j) => ({ termMonths: j.term_months, isSuspended: j.suspended_months != null })),
    p25Months: distRow?.p25_months ?? quantile(sortedTerms, 0.25),
    medianMonths: distRow?.median_months ?? quantile(sortedTerms, 0.5),
    p75Months: distRow?.p75_months ?? quantile(sortedTerms, 0.75),
  });

  const custodialN = distRow?.custodial_n ?? judgAttrs.length;
  const suspendedN = distRow?.suspended_n ?? judgAttrs.filter((j) => j.suspended_months != null).length;
  const suspendedRate = custodialN > 0 ? suspendedN / custodialN : null;

  // 性別・年代別の集計（要件 §6.4: 件数下限 20 件未満は平均値を出さず件数のみ）
  const summarizeGroup = (rows: JudgAttr[]) => {
    const n = rows.length;
    const ratios = rows.map((r) => r.ratio_to_demand).filter((v): v is number => v != null);
    const pos = rows.map((r) => r.position_in_range).filter((v): v is number => v != null);
    const susp = rows.filter((r) => r.suspended_months != null).length;
    return {
      n,
      ratioCi: ratios.length >= MIN_METRIC_N ? ci95(ratios) : null,
      posCi: pos.length >= MIN_METRIC_N ? ci95(pos) : null,
      suspendedRate: n >= MIN_METRIC_N ? susp / n : null,
    };
  };

  const genderGroups = ["male", "female", "unknown"].map((g) => ({
    label: g === "unknown" ? "記載なし" : formatGender(g),
    ...summarizeGroup(
      judgAttrs.filter((r) => (g === "unknown" ? !r.defendant_gender || r.defendant_gender === "unknown" : r.defendant_gender === g)),
    ),
  }));

  const ageKeys = ["20代", "30代", "40代", "50代", "60代", "70代", "80代", "記載なし"];
  const ageGroups = ageKeys
    .map((ag) => ({
      label: ag,
      ...summarizeGroup(
        judgAttrs.filter((r) => (ag === "記載なし" ? !r.defendant_age_group : r.defendant_age_group === ag)),
      ),
    }))
    .filter((g) => g.n > 0);

  const cases = (casesRes?.results ?? []) as {
    id: string;
    title: string;
    prefecture: string | null;
    latest_stage: string;
    progress: string | null;
    latest_at: string;
  }[];

  const chart = renderMonthlyBarChart(monthly.slice(-12));
  const canonicalPath = `/laws/${encodeURIComponent(law.code)}`;
  const lawText = LAW_TEXTS[law.code];
  const pastPeriods = periods.filter((p) => p !== currentPeriod);

  const renderDemoRows = (
    rows: {
      label: string;
      n: number;
      ratioCi: { mean: number; low: number; high: number } | null;
      suspendedRate: number | null;
    }[],
  ) => {
    if (!rows.length) return html`<p class="muted small mb-0">データがありません。</p>`;
    return html`<div class="demo-sent-list">
      ${rows.map((g) => {
        const suspPct = g.suspendedRate != null ? Math.round(g.suspendedRate * 100) : null;
        const prisonPct = suspPct != null ? 100 - suspPct : null;
        return html`<div class="demo-sent-row">
          <div class="demo-sent-label">
            ${g.label}
            <span class="demo-sent-count num">${g.n.toLocaleString("ja-JP")}件</span>
          </div>
          <div>
            ${suspPct != null && prisonPct != null
              ? html`<div class="demo-sent-bar" aria-label="実刑 ${prisonPct}% 執行猶予 ${suspPct}%">
                  ${prisonPct > 0
                    ? html`<span class="demo-sent-seg" style="width:${prisonPct}%;background:var(--accent)"
                        >${prisonPct >= 22 ? `実刑 ${prisonPct}%` : ""}</span
                      >`
                    : ""}
                  ${suspPct > 0
                    ? html`<span class="demo-sent-seg" style="width:${suspPct}%;background:#38bdf8"
                        >${suspPct >= 22 ? `猶予 ${suspPct}%` : ""}</span
                      >`
                    : ""}
                </div>`
              : html`<div class="demo-sent-muted">${MIN_METRIC_N}件未満のため件数のみ表示</div>`}
          </div>
          <div class="demo-sent-ratio num">
            ${g.ratioCi
              ? html`<strong>${formatPct(g.ratioCi.mean)}</strong>
                  <span class="demo-sent-ci">(${formatPct(g.ratioCi.low)}〜${formatPct(g.ratioCi.high)})</span>`
              : html`<span class="muted">—</span>`}
          </div>
        </div>`;
      })}
    </div>`;
  };

  const demoTabScript = `
(() => {
  const btns = document.querySelectorAll("[data-demo-tab]");
  const panels = document.querySelectorAll("[data-demo-panel]");
  btns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.demoTab;
      btns.forEach((b) => b.classList.toggle("is-active", b === btn));
      panels.forEach((p) => { p.style.display = p.dataset.demoPanel === target ? "" : "none"; });
    });
  });
})();
`;

  const body = html`
    <section class="card">
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:8px;font-size:12.5px" class="muted">
        <a href="/laws" style="font-weight:600">← 法律一覧</a>
        <span>·</span>
        <span>${law.category} · ${law.group_name}</span>
      </div>

      <div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 10px;margin-bottom:10px">
        <h1 class="page-h1 mb-0">${law.name}</h1>
        <span class="pill">${law.law_name}</span>
      </div>

      ${lawText
        ? html`<p style="margin:0 0 12px;color:var(--text);font-size:14.5px;line-height:1.7">${lawText.summary}</p>`
        : ""}

      ${currentPeriod
        ? html`<div class="penalty-strip">
            <div>
              <span class="muted small">現行法定刑: </span>
              <strong>${currentPeriod.statutory_penalty}</strong>
              ${currentPeriod.verified === 0 ? html` <span class="pill">確認中</span>` : ""}
            </div>
            <span class="small muted num">${formatDateJa(currentPeriod.effective_from)}〜</span>
          </div>`
        : ""}

      <div style="display:flex;flex-direction:column;gap:8px">
        ${lawText
          ? html`<details class="article-details">
              <summary class="article-summary">条文全文を見る（${lawText.articleTitle}）</summary>
              <div class="article-body">${lawText.articleText}</div>
            </details>`
          : ""}
        ${pastPeriods.length
          ? html`<details class="article-details">
              <summary class="article-summary">過去の法定刑・改正履歴を見る（${pastPeriods.length}件）</summary>
              <div class="article-body">
                ${pastPeriods.map(
                  (p) => html`<div style="margin-bottom:6px">
                    <span class="num small muted"
                      >${formatDateJa(p.effective_from)} 〜 ${p.effective_to ? `${formatDateJa(p.effective_to)}前日` : "現行"}</span
                    ><br />
                    <strong>${p.statutory_penalty}</strong>
                  </div>`,
                )}
              </div>
            </details>`
          : ""}
      </div>
    </section>

    <section class="bento-kpi mt-16">
      <a class="kpi-card" href="/cases?law=${encodeURIComponent(law.code)}">
        <div class="kpi-head">
          <span class="kpi-label">事件数</span>
          <span class="kpi-arrow" aria-hidden="true">→</span>
        </div>
        <div class="kpi-value num">${totalCases.toLocaleString("ja-JP")}<span class="kpi-unit">件</span></div>
      </a>
      <a class="kpi-card" href="/cases?law=${encodeURIComponent(law.code)}&has_judgment=1">
        <div class="kpi-head">
          <span class="kpi-label">有期刑判決</span>
          <span class="kpi-arrow" aria-hidden="true">→</span>
        </div>
        <div class="kpi-value num">${custodialN.toLocaleString("ja-JP")}<span class="kpi-unit">件</span></div>
      </a>
      <div class="kpi-card">
        <div class="kpi-label">執行猶予率</div>
        <div class="kpi-value num">${custodialN >= MIN_METRIC_N ? formatPct(suspendedRate) : "—"}</div>
        <div class="kpi-sub">${custodialN < MIN_METRIC_N ? `${MIN_METRIC_N}件未満非表示` : `n=${custodialN}`}</div>
      </div>
    </section>

    ${distChart
      ? html`<section class="card">
          <h2 class="card-title">
            <span>量刑の分布（${judgAttrs.length}件）</span>
            <span class="chart-legend" aria-hidden="true">
              <span class="chart-legend-item"
                ><span class="chart-dot" style="background:var(--accent)"></span>実刑</span
              >
              <span class="chart-legend-item"
                ><span class="chart-dot" style="background:#38bdf8"></span>執行猶予</span
              >
            </span>
          </h2>
          ${distRow && distRow.n >= MIN_METRIC_N
            ? html`<div class="pills" style="margin:-4px 0 10px">
                <span class="pill num">中央値 <strong>${formatMonths(Math.round(distRow.median_months ?? 0))}</strong></span>
                <span class="pill num"
                  >25〜75%: ${formatMonths(Math.round(distRow.p25_months ?? 0))}〜${formatMonths(Math.round(distRow.p75_months ?? 0))}</span
                >
                ${distRow.n_ratio_to_demand >= MIN_METRIC_N
                  ? html`<span class="pill num">求刑比平均 ${formatPct(distRow.avg_ratio_to_demand)}</span>`
                  : ""}
              </div>`
            : ""}
          ${distChart}
        </section>`
      : ""}

    ${chart
      ? html`<section class="card mt-16">
          <h2 class="card-title">月ごとの件数推移</h2>
          ${chart}
        </section>`
      : ""}

    <section class="card mt-16">
      <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px">
        <h2 class="card-title mb-0">属性別の量刑傾向</h2>
        <div class="segmented" role="tablist" aria-label="属性の切替">
          <button type="button" class="is-active" data-demo-tab="gender">性別</button>
          <button type="button" data-demo-tab="age">年代</button>
        </div>
      </div>
      <div class="chart-legend" style="margin-bottom:10px" aria-hidden="true">
        <span class="chart-legend-item"><span class="chart-dot" style="background:var(--accent)"></span>実刑</span>
        <span class="chart-legend-item"><span class="chart-dot" style="background:#38bdf8"></span>執行猶予</span>
        <span class="chart-legend-item">右列: 求刑比（判決÷求刑）</span>
      </div>
      <div data-demo-panel="gender">${renderDemoRows(genderGroups)}</div>
      <div data-demo-panel="age" style="display:none">${renderDemoRows(ageGroups)}</div>
      <p class="small muted mb-0 mt-12">
        ※ 報道された成人有期刑の集計（前科・示談等の事情は未補正）。
      </p>
    </section>

    <section class="card mt-16">
      <h2 class="card-title">
        <span>最近の事件</span>
        <a class="small" href="/cases?law=${encodeURIComponent(law.code)}">すべて見る →</a>
      </h2>
      ${cases.length
        ? html`<ul class="feed">
            ${cases.map(
              (k) => html`<li class="feed-item">
                <div class="feed-meta">
                  <span class="pill ${stageBadgeClass(k.latest_stage)}">${k.latest_stage}</span>
                  <span>${k.prefecture ?? "場所不明"}</span>
                  <span class="num">${formatDateShort(k.latest_at)}</span>
                </div>
                <a class="feed-title" href="/cases/${encodeURIComponent(k.id)}">${k.title}</a>
              </li>`,
            )}
          </ul>`
        : html`<p class="muted small mb-0">該当する事件はまだありません。</p>`}
    </section>

    <script>
      ${raw(demoTabScript)}
    </script>
  `;

  return c.html(
    renderLayout({
      title: `${law.name}（${law.law_name}）｜HANZAI Watch`,
      description: `${law.name}の条文・要約・法定刑、報道された事件数（${totalCases}件）、判決の量刑分布データ。`,
      activeNav: "laws",
      canonicalPath,
      origin,
      body,
    }),
  );
}
