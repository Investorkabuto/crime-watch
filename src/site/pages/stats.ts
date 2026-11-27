// 統計ページ（/stats）と CSV エクスポート（/stats/export.csv）
import type { Context } from "hono";
import { html, raw } from "hono/html";
import type { Env } from "../../env";
import { nationalityStats } from "../../natstats";
import { PREFECTURES } from "../../schema";
import { csvCell } from "../format";
import { renderLayout } from "../layout";
import { per100k } from "../population";

const AGE_ORDER = ["10歳未満", "10代", "20代", "30代", "40代", "50代", "60代", "70代", "80代", "90代以上", "記載なし"] as const;

function buildBaseWhere(q: { from?: string; to?: string; law?: string; prefecture?: string }) {
  const where = ["c.status = 'published'"];
  const binds: unknown[] = [];
  const dateExpr = "COALESCE(c.occurred_on, substr(c.latest_at, 1, 10))";
  if (q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from)) {
    where.push(`${dateExpr} >= ?`);
    binds.push(q.from);
  }
  if (q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to)) {
    where.push(`${dateExpr} <= ?`);
    binds.push(q.to);
  }
  if (q.law) {
    where.push(
      `(EXISTS (SELECT 1 FROM reports r JOIN report_charges rc ON rc.report_id = r.id WHERE r.case_id = c.id AND rc.law_code = ?)
        OR EXISTS (SELECT 1 FROM judgments j JOIN judgment_charges jc ON jc.judgment_id = j.id WHERE j.case_id = c.id AND j.status = 'published' AND jc.law_code = ?))`,
    );
    binds.push(q.law, q.law);
  }
  if (q.prefecture) {
    if (q.prefecture === "不明") where.push("c.prefecture IS NULL");
    else {
      where.push("c.prefecture = ?");
      binds.push(q.prefecture);
    }
  }
  return { whereSql: where.join(" AND "), binds };
}

/** 統計ページ /stats */
export async function renderStatsPage(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const origin = new URL(c.req.url).origin;
  const q = c.req.query();
  const { whereSql, binds } = buildBaseWhere(q);

  const peopleCte = `
    base AS (SELECT c.id, c.prefecture FROM cases c WHERE ${whereSql}),
    raw_p AS (
      SELECT r.case_id, COALESCE(p.person_ref, r.id || ':' || p.seq) AS pk, p.gender, p.age_group, p.occupation
        FROM report_persons p JOIN reports r ON r.id = p.report_id
      UNION ALL
      SELECT j.case_id, COALESCE(j.person_ref, j.id), j.defendant_gender, j.defendant_age_group, j.defendant_occupation
        FROM judgments j WHERE j.status = 'published'
    ),
    people AS (
      SELECT raw_p.case_id, raw_p.pk, MAX(raw_p.gender) AS gender, MAX(raw_p.age_group) AS age_group,
             MAX(raw_p.occupation) AS occupation
      FROM raw_p JOIN base b ON b.id = raw_p.case_id
      GROUP BY raw_p.case_id, raw_p.pk
    )`;

  const [lawsListRes, crossRes, ageGenderRes, occRes, natData] = await Promise.all([
    db.prepare("SELECT code, name FROM laws ORDER BY sort_order").all<{ code: string; name: string }>(),
    db
      .prepare(
        `WITH base AS (SELECT c.id, COALESCE(c.prefecture, '不明') AS prefecture FROM cases c WHERE ${whereSql}),
              case_laws AS (
                SELECT r.case_id, rc.law_code FROM report_charges rc JOIN reports r ON r.id = rc.report_id WHERE rc.law_code IS NOT NULL
                UNION
                SELECT j.case_id, jc.law_code FROM judgment_charges jc JOIN judgments j ON j.id = jc.judgment_id WHERE jc.law_code IS NOT NULL AND j.status = 'published'
              )
         SELECT b.prefecture, l.code AS law_code, l.name AS law_name, COUNT(DISTINCT b.id) AS cases
         FROM base b JOIN case_laws cl ON cl.case_id = b.id JOIN laws l ON l.code = cl.law_code
         GROUP BY 1, 2, 3
         ORDER BY cases DESC, b.prefecture ASC
         LIMIT 60`,
      )
      .bind(...binds)
      .all<{ prefecture: string; law_code: string; law_name: string; cases: number }>(),
    db
      .prepare(
        `WITH ${peopleCte}
         SELECT COALESCE(age_group, '記載なし') AS age_group,
                COALESCE(gender, 'unknown') AS gender,
                COUNT(*) AS people
         FROM people
         GROUP BY 1, 2`,
      )
      .bind(...binds)
      .all<{ age_group: string; gender: string; people: number }>(),
    db
      .prepare(
        `WITH ${peopleCte}
         SELECT COALESCE(occupation, '記載なし') AS occupation, COUNT(*) AS people
         FROM people
         GROUP BY 1
         ORDER BY people DESC
         LIMIT 16`,
      )
      .bind(...binds)
      .all<{ occupation: string; people: number }>(),
    nationalityStats(db, { from: q.from, to: q.to, law: q.law, prefecture: q.prefecture }),
  ]);

  // 統計の現在の絞り込み条件を引き継いだ /cases リンク生成ヘルパー
  const casesHref = (extra: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    if (q.from) sp.set("from", q.from);
    if (q.to) sp.set("to", q.to);
    if (q.law) sp.set("law", q.law);
    if (q.prefecture) sp.set("prefecture", q.prefecture);
    for (const [k, v] of Object.entries(extra)) {
      if (v) sp.set(k, v);
    }
    return `/cases?${sp.toString()}`;
  };

  // 性別×年代マトリクスの構築
  const matrixMap = new Map<string, { male: number; female: number; unknown: number; total: number }>();
  let totalMale = 0;
  let totalFemale = 0;
  let totalUnknown = 0;
  for (const r of ageGenderRes.results) {
    const ag = r.age_group || "記載なし";
    const row = matrixMap.get(ag) ?? { male: 0, female: 0, unknown: 0, total: 0 };
    const n = Number(r.people);
    if (r.gender === "male") {
      row.male += n;
      totalMale += n;
    } else if (r.gender === "female") {
      row.female += n;
      totalFemale += n;
    } else {
      row.unknown += n;
      totalUnknown += n;
    }
    row.total += n;
    matrixMap.set(ag, row);
  }
  const totalPeople = totalMale + totalFemale + totalUnknown;
  const pct = (n: number) => (totalPeople > 0 ? Math.round((n / totalPeople) * 100) : 0);
  const malePct = pct(totalMale);
  const femalePct = pct(totalFemale);
  const unknownPct = Math.max(0, 100 - malePct - femalePct);

  const orderedAgeKeys = [
    ...AGE_ORDER.filter((k) => matrixMap.has(k)),
    ...[...matrixMap.keys()].filter((k) => !(AGE_ORDER as readonly string[]).includes(k)),
  ];

  // 職業別バーの最大値
  const occRows = occRes.results;
  const maxOcc = Math.max(1, ...occRows.map((o) => o.people));

  // 国籍別（記載ありのみをグラフ描画）
  const statedNats = natData.nationalities.filter((r) => r.nationality !== "記載なし");
  const maxNat = Math.max(1, ...statedNats.map((r) => r.people));

  const csvParams = new URLSearchParams();
  if (q.from) csvParams.set("from", q.from);
  if (q.to) csvParams.set("to", q.to);
  if (q.law) csvParams.set("law", q.law);
  if (q.prefecture) csvParams.set("prefecture", q.prefecture);
  const csvHref = `/stats/export.csv${csvParams.toString() ? `?${csvParams.toString()}` : ""}`;

  const activeChips: string[] = [];
  if (q.from || q.to) activeChips.push(`${q.from ?? "…"} 〜 ${q.to ?? "…"}`);
  if (q.law) activeChips.push(lawsListRes.results.find((l) => l.code === q.law)?.name ?? q.law);
  if (q.prefecture) activeChips.push(q.prefecture);

  const drawerBody = html`
    <form method="get" action="/stats" class="drawer-form">
      <div class="drawer-grid">
        <div class="drawer-field">
          <label for="s-from">開始日</label>
          <input id="s-from" class="input" type="date" name="from" value="${q.from ?? ""}" />
        </div>
        <div class="drawer-field">
          <label for="s-to">終了日</label>
          <input id="s-to" class="input" type="date" name="to" value="${q.to ?? ""}" />
        </div>
        <div class="drawer-field">
          <label for="s-law">法律</label>
          <select id="s-law" class="input" name="law">
            <option value="">すべての法律</option>
            ${lawsListRes.results.map(
              (l) => html`<option value="${l.code}" ${q.law === l.code ? "selected" : ""}>${l.name}</option>`,
            )}
          </select>
        </div>
        <div class="drawer-field">
          <label for="s-pref">都道府県</label>
          <select id="s-pref" class="input" name="prefecture">
            <option value="">すべての都道府県</option>
            ${PREFECTURES.map(
              (p) => html`<option value="${p}" ${q.prefecture === p ? "selected" : ""}>${p}</option>`,
            )}
            <option value="不明" ${q.prefecture === "不明" ? "selected" : ""}>不明</option>
          </select>
        </div>
      </div>
      <div class="drawer-actions">
        <a class="btn" href="/stats">リセット</a>
        <a class="btn" href="${csvHref}">CSV ダウンロード</a>
        <button class="btn btn-primary" type="submit">この条件で集計</button>
      </div>
    </form>
  `;

  const tabScript = `
(() => {
  const btns = document.querySelectorAll("[data-stats-tab]");
  const panels = document.querySelectorAll("[data-stats-panel]");
  const validTabs = new Set(["demo", "occ", "nat", "cross"]);
  const activate = (target, persist) => {
    const t = validTabs.has(target) ? target : "demo";
    btns.forEach((b) => b.classList.toggle("is-active", b.dataset.statsTab === t));
    panels.forEach((p) => { p.style.display = p.dataset.statsPanel === t ? "" : "none"; });
    if (persist) {
      try { sessionStorage.setItem("cw_stats_tab", t); } catch {}
      try { history.replaceState(null, "", "#tab=" + t); } catch {}
    }
  };
  const restore = () => {
    const m = location.hash.match(/tab=([a-z]+)/);
    let saved = m ? m[1] : null;
    if (!saved) {
      try { saved = sessionStorage.getItem("cw_stats_tab"); } catch {}
    }
    if (saved && validTabs.has(saved)) activate(saved, false);
  };
  btns.forEach((btn) => {
    btn.addEventListener("click", () => activate(btn.dataset.statsTab, true));
  });
  restore();
  window.addEventListener("pageshow", restore);
  const moreBtn = document.getElementById("cw-cross-more");
  if (moreBtn) {
    moreBtn.addEventListener("click", () => {
      document.querySelectorAll("tr[data-cross-extra]").forEach((tr) => { tr.style.display = ""; });
      moreBtn.remove();
    });
  }
})();
`;

  const body = html`
    <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px">
      <h1 class="page-h1 mb-0">統計</h1>
      <a class="pill" href="${csvHref}">CSV ダウンロード →</a>
    </div>

    ${activeChips.length > 0
      ? html`<section class="card filter-bar" style="margin-bottom:14px">
          <div class="pills">
            ${activeChips.map((chip) => html`<span class="pill pill-accent">${chip}</span>`)}
            <a class="pill" href="/stats">リセット</a>
          </div>
        </section>`
      : ""}

    <div style="margin-bottom:14px;overflow-x:auto;scrollbar-width:none">
      <div class="segmented" role="tablist" aria-label="統計の種別">
        <button type="button" class="is-active" data-stats-tab="demo">性別・年代</button>
        <button type="button" data-stats-tab="occ">職業</button>
        <button type="button" data-stats-tab="nat">国籍</button>
        <button type="button" data-stats-tab="cross">都道府県×法律</button>
      </div>
    </div>

    <!-- タブ 1: 性別・年代 -->
    <section class="card" data-stats-panel="demo">
      <h2 class="card-title">
        <span>性別・年代別の内訳（人単位）</span>
        <span class="small muted">タップで事件一覧へ</span>
      </h2>

      ${totalPeople > 0
        ? html`<div class="ratio-bar" aria-label="性別比率">
            ${totalMale > 0
              ? html`<a
                  class="ratio-seg"
                  href="${casesHref({ gender: "male" })}"
                  style="width:${(totalMale / totalPeople) * 100}%;background:var(--accent)"
                  title="男性 ${totalMale}人"
                  >${malePct >= 14 ? `男性 ${malePct}%` : ""}</a
                >`
              : ""}
            ${totalFemale > 0
              ? html`<a
                  class="ratio-seg"
                  href="${casesHref({ gender: "female" })}"
                  style="width:${(totalFemale / totalPeople) * 100}%;background:#38bdf8"
                  title="女性 ${totalFemale}人"
                  >${femalePct >= 14 ? `女性 ${femalePct}%` : ""}</a
                >`
              : ""}
            ${totalUnknown > 0
              ? html`<a
                  class="ratio-seg"
                  href="${casesHref({ gender: "unknown" })}"
                  style="width:${(totalUnknown / totalPeople) * 100}%;background:var(--muted)"
                  title="記載なし ${totalUnknown}人"
                  >${unknownPct >= 10 ? `${unknownPct}%` : ""}</a
                >`
              : ""}
          </div>`
        : ""}

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>年代</th>
              <th class="num"><a href="${casesHref({ gender: "male" })}">男性</a></th>
              <th class="num"><a href="${casesHref({ gender: "female" })}">女性</a></th>
              <th class="num"><a href="${casesHref({ gender: "unknown" })}">記載なし</a></th>
              <th class="num">合計</th>
            </tr>
          </thead>
          <tbody>
            ${orderedAgeKeys.length
              ? orderedAgeKeys.map((ag) => {
                  const row = matrixMap.get(ag)!;
                  return html`<tr>
                    <td><a href="${casesHref({ age_group: ag })}" style="font-weight:600">${ag}</a></td>
                    <td class="num">
                      ${row.male > 0
                        ? html`<a href="${casesHref({ age_group: ag, gender: "male" })}">${row.male.toLocaleString("ja-JP")}</a>`
                        : html`<span class="muted">0</span>`}
                    </td>
                    <td class="num">
                      ${row.female > 0
                        ? html`<a href="${casesHref({ age_group: ag, gender: "female" })}">${row.female.toLocaleString("ja-JP")}</a>`
                        : html`<span class="muted">0</span>`}
                    </td>
                    <td class="num">
                      ${row.unknown > 0
                        ? html`<a href="${casesHref({ age_group: ag, gender: "unknown" })}">${row.unknown.toLocaleString("ja-JP")}</a>`
                        : html`<span class="muted">0</span>`}
                    </td>
                    <td class="num">
                      <a href="${casesHref({ age_group: ag })}" style="font-weight:700">${row.total.toLocaleString("ja-JP")}</a>
                    </td>
                  </tr>`;
                })
              : html`<tr><td colspan="5" class="muted small">該当するデータがありません。</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>

    <!-- タブ 2: 職業 -->
    <section class="card" data-stats-panel="occ" style="display:none">
      <h2 class="card-title">
        <span>職業別の人数（人単位・上位）</span>
        <span class="small muted">タップで事件一覧へ</span>
      </h2>
      ${occRows.length
        ? html`<div class="bar-grid">
            ${occRows.map((o) => {
              const barPct = Math.max(6, Math.round((o.people / maxOcc) * 100));
              return html`<a class="bar-card" href="${casesHref({ occupation: o.occupation })}">
                <div class="bar-card-head">
                  <span class="bar-card-label">${o.occupation}</span>
                  <span class="bar-card-val num">${o.people.toLocaleString("ja-JP")}<span class="small muted">人</span></span>
                </div>
                <div class="bar-track" aria-hidden="true">
                  <div class="bar-fill" style="width:${barPct}%"></div>
                </div>
              </a>`;
            })}
          </div>`
        : html`<p class="muted small mb-0">該当するデータがありません。</p>`}
    </section>

    <!-- タブ 3: 国籍（グラフ） -->
    <section class="card" data-stats-panel="nat" style="display:none">
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
                return html`<a class="nat-row" href="${casesHref({ nationality: r.nationality })}" role="listitem">
                  <span class="nat-label">${r.nationality}</span>
                  <span class="nat-track" title="来日外国人 ${r.residence["来日外国人"]}人 / 定着居住者 ${r.residence["定着居住者"]}人 / 不明 ${r.residence["不明"]}人">
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
              <span class="chart-legend-item"><span class="chart-dot" style="background:var(--accent)"></span>来日外国人</span>
              <span class="chart-legend-item"><span class="chart-dot" style="background:#38bdf8"></span>定着居住者</span>
              <span class="chart-legend-item"><span class="chart-dot" style="background:var(--muted)"></span>在留資格不明</span>
            </div>`
        : html`<p class="muted small mb-0">国籍の記載があるデータはまだありません。</p>`}

      <hr class="divider" />
      <h3 class="card-title" style="font-size:15px">
        <span>在留資格別の分布</span>
        <span class="small muted">タップで事件一覧へ</span>
      </h3>
      ${(() => {
        const resRows = natData.residence_breakdown;
        if (!resRows.length) {
          return html`<p class="muted small mb-0">在留資格の記載があるデータはまだありません。</p>`;
        }
        const maxRes = Math.max(1, ...resRows.map((r) => r.people));
        const totalRes = resRows.reduce((acc, r) => acc + r.people, 0);
        return html`<div class="nat-list" role="list" aria-label="在留資格別の分布グラフ">
          ${resRows.map((r) => {
            const w = Math.max(6, (r.people / maxRes) * 100);
            const share = totalRes > 0 ? Math.round((r.people / totalRes) * 100) : 0;
            const col =
              r.group === "定着居住者" ? "#38bdf8" : r.group === "来日外国人" ? "var(--accent)" : "var(--muted)";
            return html`<a
              class="nat-row"
              href="${casesHref({ residence_status: r.status })}"
              role="listitem"
            >
              <span class="nat-label">${r.status}</span>
              <span class="nat-track" title="${r.status}: ${r.people}人（全体の ${share}%）">
                <span class="nat-seg" style="width:${w}%;background:${col}">${w >= 18 ? `${share}%` : ""}</span>
              </span>
              <span class="nat-count num"
                >${r.people.toLocaleString("ja-JP")}人<span class="nat-chev" aria-hidden="true">›</span></span
              >
            </a>`;
          })}
        </div>`;
      })()}
    </section>

    <!-- タブ 4: 都道府県×法律 -->
    <section class="card" data-stats-panel="cross" style="display:none">
      <h2 class="card-title">
        <span>都道府県 × 法律の件数（上位 ${crossRes.results.length} 組）</span>
        <a class="small" href="${csvHref}">CSV →</a>
      </h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>都道府県</th>
              <th>法律</th>
              <th class="num">事件数</th>
              <th class="num">人口10万人あたり</th>
            </tr>
          </thead>
          <tbody>
            ${crossRes.results.length
              ? crossRes.results.map((r, idx) => {
                  const rate = per100k(r.cases, r.prefecture);
                  return html`<tr
                    ${idx >= 20 ? html`data-cross-extra="1" style="display:none"` : ""}
                  >
                    <td><a href="/prefectures/${encodeURIComponent(r.prefecture)}">${r.prefecture}</a></td>
                    <td><a href="/laws/${encodeURIComponent(r.law_code)}">${r.law_name}</a></td>
                    <td class="num">
                      <a href="${casesHref({ prefecture: r.prefecture, law: r.law_code })}" style="font-weight:700"
                        >${r.cases.toLocaleString("ja-JP")}</a
                      >
                    </td>
                    <td class="num">${rate != null ? rate.toFixed(2) : "—"}</td>
                  </tr>`;
                })
              : html`<tr><td colspan="4" class="muted small">該当するデータがありません。</td></tr>`}
          </tbody>
        </table>
      </div>
      ${crossRes.results.length > 20
        ? html`<div class="mt-12" style="text-align:center">
            <button id="cw-cross-more" type="button" class="btn">
              残り ${crossRes.results.length - 20} 件をすべて表示
            </button>
          </div>`
        : ""}
    </section>

    <script>
      ${raw(tabScript)}
    </script>
  `;

  return c.html(
    renderLayout({
      title: "統計｜HANZAI Watch",
      description: "期間・法律・都道府県別のクロス集計、性別・年代・職業・国籍別の内訳（CSV ダウンロード対応）。",
      activeNav: "stats",
      canonicalPath: "/stats",
      origin,
      drawerTitle: "統計の集計条件を絞り込む",
      drawerBody,
      activeFilterCount: activeChips.length,
      body,
    }),
  );
}

/** 統計 CSV ダウンロード /stats/export.csv */
export async function handleStatsCsvExport(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const q = c.req.query();
  const { whereSql, binds } = buildBaseWhere(q);

  const { results } = await db
    .prepare(
      `WITH base AS (SELECT c.id, COALESCE(c.prefecture, '不明') AS prefecture FROM cases c WHERE ${whereSql}),
            case_laws AS (
              SELECT r.case_id, rc.law_code FROM report_charges rc JOIN reports r ON r.id = rc.report_id WHERE rc.law_code IS NOT NULL
              UNION
              SELECT j.case_id, jc.law_code FROM judgment_charges jc JOIN judgments j ON j.id = jc.judgment_id WHERE jc.law_code IS NOT NULL AND j.status = 'published'
            )
       SELECT b.prefecture, l.code AS law_code, l.name AS law_name, COUNT(DISTINCT b.id) AS cases
       FROM base b JOIN case_laws cl ON cl.case_id = b.id JOIN laws l ON l.code = cl.law_code
       GROUP BY 1, 2, 3
       ORDER BY b.prefecture ASC, cases DESC`,
    )
    .bind(...binds)
    .all<{ prefecture: string; law_code: string; law_name: string; cases: number }>();

  const header = ["prefecture", "law_code", "law_name", "cases", "cases_per_100k"].join(",");
  const lines = results.map((r) => {
    const rate = per100k(r.cases, r.prefecture);
    return [csvCell(r.prefecture), csvCell(r.law_code), csvCell(r.law_name), csvCell(r.cases), csvCell(rate ?? "")].join(",");
  });

  const csv = "\uFEFF" + [header, ...lines].join("\r\n") + "\r\n";
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="hanzai-watch-stats.csv"',
    },
  });
}
