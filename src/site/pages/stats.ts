// 統計ページ（/stats）と CSV エクスポート（/stats/export.csv）
import type { Context } from "hono";
import { html } from "hono/html";
import type { Env } from "../../env";
import { nationalityStats } from "../../natstats";
import { PREFECTURES } from "../../schema";
import { csvCell, formatGender } from "../format";
import { renderLayout } from "../layout";
import { per100k } from "../population";

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

  const [lawsListRes, crossRes, genderRes, ageRes, occRes, natData] = await Promise.all([
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
      .prepare(`WITH ${peopleCte} SELECT COALESCE(gender, 'unknown') AS gender, COUNT(*) AS people FROM people GROUP BY 1 ORDER BY people DESC`)
      .bind(...binds)
      .all<{ gender: string; people: number }>(),
    db
      .prepare(`WITH ${peopleCte} SELECT COALESCE(age_group, '記載なし') AS age_group, COUNT(*) AS people FROM people GROUP BY 1 ORDER BY people DESC`)
      .bind(...binds)
      .all<{ age_group: string; people: number }>(),
    db
      .prepare(`WITH ${peopleCte} SELECT COALESCE(occupation, '記載なし') AS occupation, COUNT(*) AS people FROM people GROUP BY 1 ORDER BY people DESC LIMIT 15`)
      .bind(...binds)
      .all<{ occupation: string; people: number }>(),
    nationalityStats(db, { from: q.from, to: q.to, law: q.law, prefecture: q.prefecture }),
  ]);

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

  const body = html`
    <h1 class="page-h1">統計</h1>
    <p class="page-lead">
      クロス集計と性別・年代・職業・国籍別の内訳を確認できます（右上の検索ボタンから期間・法律・都道府県で絞り込めます）。
    </p>

    ${activeChips.length > 0
      ? html`<section class="card filter-bar" style="margin-bottom:16px">
          <div class="pills">
            ${activeChips.map((chip) => html`<span class="pill pill-accent">${chip}</span>`)}
            <a class="pill" href="/stats">リセット</a>
          </div>
        </section>`
      : ""}

    <section class="card">
      <h2 class="card-title">
        <span>都道府県 × 法律の件数（上位 60 組）</span>
        <a class="small" href="${csvHref}">CSV ダウンロード →</a>
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
              ? crossRes.results.map((r) => {
                  const rate = per100k(r.cases, r.prefecture);
                  const caseParams = new URLSearchParams({ prefecture: r.prefecture, law: r.law_code });
                  if (q.from) caseParams.set("from", q.from);
                  if (q.to) caseParams.set("to", q.to);
                  return html`<tr>
                    <td><a href="/prefectures/${encodeURIComponent(r.prefecture)}">${r.prefecture}</a></td>
                    <td><a href="/laws/${encodeURIComponent(r.law_code)}">${r.law_name}</a></td>
                    <td class="num">
                      <a href="/cases?${caseParams.toString()}" style="font-weight:700">${r.cases.toLocaleString("ja-JP")}</a>
                    </td>
                    <td class="num">${rate != null ? rate.toFixed(2) : "—"}</td>
                  </tr>`;
                })
              : html`<tr><td colspan="4" class="muted small">該当するデータがありません。</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>

    <div class="bento-equal">
      <section class="card">
        <h2 class="card-title">性別・年代別の人数（人単位）</h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>性別</th><th class="num">人数</th></tr></thead>
            <tbody>
              ${genderRes.results.length
                ? genderRes.results.map(
                    (g) => html`<tr><td>${formatGender(g.gender)}</td><td class="num">${g.people.toLocaleString("ja-JP")}</td></tr>`,
                  )
                : html`<tr><td colspan="2" class="muted small">データなし</td></tr>`}
            </tbody>
          </table>
        </div>
        <hr class="divider" />
        <div class="table-wrap">
          <table>
            <thead><tr><th>年代</th><th class="num">人数</th></tr></thead>
            <tbody>
              ${ageRes.results.length
                ? ageRes.results.map(
                    (a) => html`<tr><td>${a.age_group}</td><td class="num">${a.people.toLocaleString("ja-JP")}</td></tr>`,
                  )
                : html`<tr><td colspan="2" class="muted small">データなし</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>

      <section class="card">
        <h2 class="card-title">職業別の人数（人単位・上位）</h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>職業区分</th><th class="num">人数</th></tr></thead>
            <tbody>
              ${occRes.results.length
                ? occRes.results.map(
                    (o) => html`<tr><td>${o.occupation}</td><td class="num">${o.people.toLocaleString("ja-JP")}</td></tr>`,
                  )
                : html`<tr><td colspan="2" class="muted small">データなし</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <section class="card mt-16">
      <h2 class="card-title">国籍・在留資格別の人数（人単位）</h2>
      <p class="small muted" style="margin:-6px 0 12px">
        記事に明記された国籍のみを記録しています。「記載なし」は日本国籍とはみなしません。
        人口あたりの補正はしていません（合計 ${natData.total_people.toLocaleString("ja-JP")} 人／うち国籍記載あり ${natData.stated_people.toLocaleString("ja-JP")} 人）。
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
              <th class="num hide-sm">在留資格不明</th>
            </tr>
          </thead>
          <tbody>
            ${natData.nationalities.length
              ? natData.nationalities.map(
                  (r) => html`<tr>
                    <td>${r.nationality}</td>
                    <td class="num">${r.people.toLocaleString("ja-JP")}</td>
                    <td class="num">${r.cases.toLocaleString("ja-JP")}</td>
                    <td class="num">${r.residence["来日外国人"].toLocaleString("ja-JP")}</td>
                    <td class="num">${r.residence["定着居住者"].toLocaleString("ja-JP")}</td>
                    <td class="num hide-sm">${r.residence["不明"].toLocaleString("ja-JP")}</td>
                  </tr>`,
                )
              : html`<tr><td colspan="6" class="muted small">該当するデータがありません。</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
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
      "Content-Disposition": 'attachment; filename="crime-watch-stats.csv"',
    },
  });
}
