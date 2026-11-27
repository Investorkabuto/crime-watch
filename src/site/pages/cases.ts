// 事件一覧（/cases）と 事件詳細（/cases/:id）
import type { Context } from "hono";
import { html } from "hono/html";
import type { Env } from "../../env";
import { periodAt, type PenaltyPeriod } from "../../metrics";
import { PREF_EXPR, type PrefBasis } from "../../prefstats";
import { PREFECTURES } from "../../schema";
import { THEMES } from "../../themes";
import {
  formatAge,
  formatDateJa,
  formatDateShort,
  formatDemand,
  formatGender,
  formatHarmResult,
  formatJuvenileClass,
  formatModifier,
  formatPct,
  formatPlea,
  formatSentence,
  formatSettlement,
  formatYen,
  isFinalized,
  safeHref,
} from "../format";
import { renderLayout } from "../layout";
import { renderSentencingBar } from "../svg";

const PAGE_SIZE = 30;
const PROGRESS_OPTIONS = ["捜査中", "処分保留", "公判中", "略式手続", "判決後（未確定）", "確定", "不起訴", "家裁送致"] as const;

function buildQuery(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** 事件一覧 /cases */
export async function renderCasesListPage(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const origin = new URL(c.req.url).origin;
  const q = c.req.query();
  const page = Math.max(1, Number.parseInt(q.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const where: string[] = ["c.status = 'published'"];
  const binds: unknown[] = [];

  if (q.q?.trim()) {
    const kw = q.q.trim();
    where.push(
      `(c.title LIKE ? OR c.summary LIKE ?
        OR EXISTS (SELECT 1 FROM reports r JOIN report_charges rc ON rc.report_id = r.id WHERE r.case_id = c.id AND rc.raw_text LIKE ?)
        OR EXISTS (SELECT 1 FROM judgments j JOIN judgment_charges jc ON jc.judgment_id = j.id WHERE j.case_id = c.id AND jc.raw_text LIKE ?))`,
    );
    binds.push(`%${kw}%`, `%${kw}%`, `%${kw}%`, `%${kw}%`);
  }
  if (q.law) {
    where.push(
      `(EXISTS (SELECT 1 FROM reports r JOIN report_charges rc ON rc.report_id = r.id WHERE r.case_id = c.id AND rc.law_code = ?)
        OR EXISTS (SELECT 1 FROM judgments j JOIN judgment_charges jc ON jc.judgment_id = j.id WHERE j.case_id = c.id AND j.status = 'published' AND jc.law_code = ?))`,
    );
    binds.push(q.law, q.law);
  }
  if (q.group) {
    where.push(
      `(EXISTS (SELECT 1 FROM reports r JOIN report_charges rc ON rc.report_id = r.id JOIN laws l ON l.code = rc.law_code WHERE r.case_id = c.id AND l.group_name = ?)
        OR EXISTS (SELECT 1 FROM judgments j JOIN judgment_charges jc ON jc.judgment_id = j.id JOIN laws l ON l.code = jc.law_code WHERE j.case_id = c.id AND j.status = 'published' AND l.group_name = ?))`,
    );
    binds.push(q.group, q.group);
  }
  if (q.theme) {
    where.push("EXISTS (SELECT 1 FROM case_themes ct WHERE ct.case_id = c.id AND ct.theme = ?)");
    binds.push(q.theme);
  }
  if (q.prefecture) {
    const basis: PrefBasis = q.pref_basis && q.pref_basis in PREF_EXPR ? (q.pref_basis as PrefBasis) : "occurrence";
    if (q.prefecture === "不明") where.push(`${PREF_EXPR[basis]} IS NULL`);
    else {
      where.push(`${PREF_EXPR[basis]} = ?`);
      binds.push(q.prefecture);
    }
  }
  if (q.city?.trim()) {
    where.push("c.city = ?");
    binds.push(q.city.trim());
  }
  if (q.gender) {
    if (q.gender === "unknown") {
      where.push(
        `(EXISTS (SELECT 1 FROM report_persons p JOIN reports r ON r.id = p.report_id WHERE r.case_id = c.id AND (p.gender IS NULL OR p.gender = 'unknown'))
          OR EXISTS (SELECT 1 FROM judgments j WHERE j.case_id = c.id AND j.status = 'published' AND (j.defendant_gender IS NULL OR j.defendant_gender = 'unknown')))`,
      );
    } else if (q.gender === "male" || q.gender === "female") {
      where.push(
        `(EXISTS (SELECT 1 FROM report_persons p JOIN reports r ON r.id = p.report_id WHERE r.case_id = c.id AND p.gender = ?)
          OR EXISTS (SELECT 1 FROM judgments j WHERE j.case_id = c.id AND j.status = 'published' AND j.defendant_gender = ?))`,
      );
      binds.push(q.gender, q.gender);
    }
  }
  if (q.age_group?.trim()) {
    const ag = q.age_group.trim();
    if (ag === "記載なし") {
      where.push(
        `(EXISTS (SELECT 1 FROM report_persons p JOIN reports r ON r.id = p.report_id WHERE r.case_id = c.id AND (p.age_group IS NULL OR p.age_group = ''))
          OR EXISTS (SELECT 1 FROM judgments j WHERE j.case_id = c.id AND j.status = 'published' AND (j.defendant_age_group IS NULL OR j.defendant_age_group = '')))`,
      );
    } else {
      where.push(
        `(EXISTS (SELECT 1 FROM report_persons p JOIN reports r ON r.id = p.report_id WHERE r.case_id = c.id AND p.age_group = ?)
          OR EXISTS (SELECT 1 FROM judgments j WHERE j.case_id = c.id AND j.status = 'published' AND j.defendant_age_group = ?))`,
      );
      binds.push(ag, ag);
    }
  }
  if (q.occupation?.trim()) {
    const occ = q.occupation.trim();
    if (occ === "記載なし") {
      where.push(
        `(EXISTS (SELECT 1 FROM report_persons p JOIN reports r ON r.id = p.report_id WHERE r.case_id = c.id AND (p.occupation IS NULL OR p.occupation = ''))
          OR EXISTS (SELECT 1 FROM judgments j WHERE j.case_id = c.id AND j.status = 'published' AND (j.defendant_occupation IS NULL OR j.defendant_occupation = '')))`,
      );
    } else {
      where.push(
        `(EXISTS (SELECT 1 FROM report_persons p JOIN reports r ON r.id = p.report_id WHERE r.case_id = c.id AND p.occupation = ?)
          OR EXISTS (SELECT 1 FROM judgments j WHERE j.case_id = c.id AND j.status = 'published' AND j.defendant_occupation = ?))`,
      );
      binds.push(occ, occ);
    }
  }
  if (q.nationality?.trim()) {
    const nat = q.nationality.trim();
    if (nat === "記載なし") {
      where.push(
        `(EXISTS (SELECT 1 FROM report_persons p JOIN reports r ON r.id = p.report_id WHERE r.case_id = c.id AND (p.nationality IS NULL OR p.nationality = ''))
          OR EXISTS (SELECT 1 FROM judgments j WHERE j.case_id = c.id AND j.status = 'published' AND (j.defendant_nationality IS NULL OR j.defendant_nationality = '')))`,
      );
    } else {
      where.push(
        `(EXISTS (SELECT 1 FROM report_persons p JOIN reports r ON r.id = p.report_id WHERE r.case_id = c.id AND p.nationality = ?)
          OR EXISTS (SELECT 1 FROM judgments j WHERE j.case_id = c.id AND j.status = 'published' AND j.defendant_nationality = ?))`,
      );
      binds.push(nat, nat);
    }
  }
  if (q.progress) {
    where.push("c.progress = ?");
    binds.push(q.progress);
  }
  if (q.juvenile === "1") where.push("c.is_juvenile = 1");
  if (q.has_judgment === "1") {
    where.push("EXISTS (SELECT 1 FROM judgments j WHERE j.case_id = c.id AND j.status = 'published')");
  }
  const dateExpr = "COALESCE(c.occurred_on, substr(c.latest_at, 1, 10))";
  if (q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from)) {
    where.push(`${dateExpr} >= ?`);
    binds.push(q.from);
  }
  if (q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to)) {
    where.push(`${dateExpr} <= ?`);
    binds.push(q.to);
  }

  const sort = q.sort === "occurred" ? "occurred" : "latest";
  const orderBy =
    sort === "occurred"
      ? "COALESCE(c.occurred_on, substr(c.latest_at, 1, 10)) DESC, c.latest_at DESC"
      : "c.latest_at DESC";

  const whereSql = where.join(" AND ");
  const [countRes, rowsRes, lawsRes] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS n FROM cases c WHERE ${whereSql}`).bind(...binds),
    db
      .prepare(
        `SELECT c.id, c.title, c.summary, c.prefecture, c.city, c.occurred_on, c.latest_stage, c.progress, c.latest_at,
                c.is_juvenile,
                (SELECT group_concat(DISTINCT ct.theme) FROM case_themes ct WHERE ct.case_id = c.id) AS themes
         FROM cases c
         WHERE ${whereSql}
         ORDER BY ${orderBy}
         LIMIT ? OFFSET ?`,
      )
      .bind(...binds, PAGE_SIZE, offset),
    db.prepare("SELECT code, name, group_name FROM laws ORDER BY sort_order"),
  ]);

  const total = Number((countRes?.results?.[0] as { n?: number } | undefined)?.n ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const cases = (rowsRes?.results ?? []) as {
    id: string;
    title: string;
    summary: string;
    prefecture: string | null;
    city: string | null;
    occurred_on: string | null;
    latest_stage: string;
    progress: string | null;
    latest_at: string;
    is_juvenile: number;
    themes: string | null;
  }[];
  const laws = (lawsRes?.results ?? []) as { code: string; name: string; group_name: string }[];
  const groups = [...new Set(laws.map((l) => l.group_name))];

  const pageUrl = (p: number) =>
    `/cases${buildQuery({
      q: q.q,
      law: q.law,
      group: q.group,
      theme: q.theme,
      prefecture: q.prefecture,
      pref_basis: q.pref_basis,
      city: q.city,
      gender: q.gender,
      age_group: q.age_group,
      occupation: q.occupation,
      nationality: q.nationality,
      progress: q.progress,
      from: q.from,
      to: q.to,
      juvenile: q.juvenile,
      has_judgment: q.has_judgment,
      sort: q.sort,
      page: p > 1 ? String(p) : undefined,
    })}`;

  const activeChips: string[] = [];
  if (q.q?.trim()) activeChips.push(`「${q.q.trim()}」`);
  if (q.prefecture) {
    const bLabel = q.pref_basis === "police" ? "捜査警察" : q.pref_basis === "court" ? "裁判所" : "発生地";
    activeChips.push(`${q.prefecture}${q.pref_basis && q.pref_basis !== "occurrence" ? `(${bLabel})` : ""}`);
  }
  if (q.city?.trim()) activeChips.push(q.city.trim());
  if (q.gender) activeChips.push(`性別: ${q.gender === "unknown" ? "記載なし" : formatGender(q.gender)}`);
  if (q.age_group?.trim()) activeChips.push(`年代: ${q.age_group.trim()}`);
  if (q.occupation?.trim()) activeChips.push(`職業: ${q.occupation.trim()}`);
  if (q.nationality?.trim()) activeChips.push(`国籍: ${q.nationality.trim()}`);
  if (q.law) activeChips.push(laws.find((l) => l.code === q.law)?.name ?? q.law);
  if (q.group) activeChips.push(q.group);
  if (q.theme) activeChips.push(`#${q.theme}`);
  if (q.progress) activeChips.push(q.progress);
  if (q.from || q.to) activeChips.push(`${q.from ?? "…"} 〜 ${q.to ?? "…"}`);
  if (q.has_judgment === "1") activeChips.push("判決あり");
  if (q.juvenile === "1") activeChips.push("少年事件");
  if (sort === "occurred") activeChips.push("発生日順");

  const drawerBody = html`
    <form method="get" action="/cases" class="drawer-form" role="search">
      <div class="drawer-keyword-wrap">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path>
        </svg>
        <input
          class="drawer-search-input"
          type="search"
          name="q"
          value="${q.q ?? ""}"
          placeholder="キーワード・罪状・事件名"
          aria-label="キーワード・罪状"
        />
        <button class="btn btn-primary" type="submit" style="padding:8px 16px;border-radius:10px">検索</button>
      </div>
      <div class="drawer-grid">
        <div class="drawer-field">
          <label for="f-pref">都道府県</label>
          <select id="f-pref" class="input" name="prefecture">
            <option value="">すべて</option>
            ${PREFECTURES.map(
              (p) => html`<option value="${p}" ${q.prefecture === p ? "selected" : ""}>${p}</option>`,
            )}
            <option value="不明" ${q.prefecture === "不明" ? "selected" : ""}>不明</option>
          </select>
        </div>
        <div class="drawer-field">
          <label for="f-basis">都道府県の基準</label>
          <select id="f-basis" class="input" name="pref_basis">
            <option value="occurrence" ${!q.pref_basis || q.pref_basis === "occurrence" ? "selected" : ""}>発生地</option>
            <option value="police" ${q.pref_basis === "police" ? "selected" : ""}>捜査警察</option>
            <option value="court" ${q.pref_basis === "court" ? "selected" : ""}>裁判所</option>
          </select>
        </div>
        <div class="drawer-field">
          <label for="f-law">法律</label>
          <select id="f-law" class="input" name="law">
            <option value="">すべて</option>
            ${laws.map((l) => html`<option value="${l.code}" ${q.law === l.code ? "selected" : ""}>${l.name}</option>`)}
          </select>
        </div>
        <div class="drawer-field">
          <label for="f-group">分類</label>
          <select id="f-group" class="input" name="group">
            <option value="">すべて</option>
            ${groups.map((g) => html`<option value="${g}" ${q.group === g ? "selected" : ""}>${g}</option>`)}
          </select>
        </div>
        <div class="drawer-field">
          <label for="f-theme">テーマ</label>
          <select id="f-theme" class="input" name="theme">
            <option value="">すべて</option>
            ${THEMES.map((t) => html`<option value="${t}" ${q.theme === t ? "selected" : ""}>${t}</option>`)}
          </select>
        </div>
        <div class="drawer-field">
          <label for="f-prog">進み具合</label>
          <select id="f-prog" class="input" name="progress">
            <option value="">すべて</option>
            ${PROGRESS_OPTIONS.map((pr) => html`<option value="${pr}" ${q.progress === pr ? "selected" : ""}>${pr}</option>`)}
          </select>
        </div>
        <div class="drawer-field">
          <label for="f-from">開始日</label>
          <input id="f-from" class="input" type="date" name="from" value="${q.from ?? ""}" />
        </div>
        <div class="drawer-field">
          <label for="f-to">終了日</label>
          <input id="f-to" class="input" type="date" name="to" value="${q.to ?? ""}" />
        </div>
        <div class="drawer-field">
          <label for="f-sort">並べ替え</label>
          <select id="f-sort" class="input" name="sort">
            <option value="latest" ${sort === "latest" ? "selected" : ""}>最近動きがあった順</option>
            <option value="occurred" ${sort === "occurred" ? "selected" : ""}>発生日順</option>
          </select>
        </div>
      </div>
      <div class="drawer-checks">
        <label>
          <input type="checkbox" name="has_judgment" value="1" ${q.has_judgment === "1" ? "checked" : ""} /> 判決ありのみ
        </label>
        <label>
          <input type="checkbox" name="juvenile" value="1" ${q.juvenile === "1" ? "checked" : ""} /> 少年事件のみ
        </label>
      </div>
      <div class="drawer-actions">
        <a class="btn" href="/cases">条件をリセット</a>
        <button class="btn btn-primary" type="submit">この条件で絞り込む</button>
      </div>
    </form>
  `;

  const body = html`
    <h1 class="page-h1">事件一覧</h1>
    <p class="page-lead">該当 <strong class="num">${total.toLocaleString("ja-JP")}</strong> 件（右上の検索ボタンから条件を絞り込めます）。</p>

    ${activeChips.length > 0
      ? html`<section class="card filter-bar" style="margin-bottom:16px">
          <div class="pills">
            ${activeChips.map((chip) => html`<span class="pill pill-accent">${chip}</span>`)}
            <a class="pill" href="/cases">リセット</a>
          </div>
        </section>`
      : ""}

    <section class="card">
      ${cases.length
        ? html`<ul class="feed">
            ${cases.map((k) => {
              const themes = k.themes ? k.themes.split(",").slice(0, 4) : [];
              return html`<li class="feed-item">
                <div class="feed-meta">
                  <span class="pill pill-accent">${k.latest_stage}</span>
                  ${k.progress ? html`<span class="small muted">${k.progress}</span>` : ""}
                  <span>${k.prefecture ?? "場所不明"}${k.city ? ` ${k.city}` : ""}</span>
                  ${k.occurred_on ? html`<span class="num">発生 ${formatDateShort(k.occurred_on)}</span>` : ""}
                  <span class="num">更新 ${formatDateShort(k.latest_at)}</span>
                </div>
                <a class="feed-title" href="/cases/${encodeURIComponent(k.id)}">${k.title}</a>
                <p class="small muted mb-0" style="margin-top:2px">${k.summary.slice(0, 140)}${k.summary.length > 140 ? "…" : ""}</p>
                ${themes.length
                  ? html`<div class="pills mt-8">
                      ${themes.map((t) => html`<a class="pill" href="/themes/${encodeURIComponent(t)}">${t}</a>`)}
                    </div>`
                  : ""}
              </li>`;
            })}
          </ul>`
        : html`<p class="muted mb-0">条件に一致する事件はありません。</p>`}

      ${totalPages > 1
        ? html`<nav class="pager" aria-label="ページ送り">
            <div>${page > 1 ? html`<a class="btn" href="${pageUrl(page - 1)}">← 前のページ</a>` : ""}</div>
            <div class="small muted num">${page} / ${totalPages} ページ</div>
            <div>${page < totalPages ? html`<a class="btn" href="${pageUrl(page + 1)}">次のページ →</a>` : ""}</div>
          </nav>`
        : ""}
    </section>
  `;

  return c.html(
    renderLayout({
      title: "事件一覧｜HANZAI Watch",
      description: "日本国内の犯罪報道・判決を都道府県・法律・テーマ・進み具合で検索・絞り込みできます。",
      activeNav: "cases",
      canonicalPath: "/cases",
      origin,
      searchQuery: q.q,
      drawerTitle: "事件を検索・絞り込み",
      drawerBody,
      activeFilterCount: activeChips.length,
      body,
    }),
  );
}

/** 進み具合ステッパーを描画 */
function renderStepper(progress: string | null, latestStage: string, hasAppealJudgment: boolean) {
  const branched = new Set(["不起訴", "処分保留", "略式手続", "家裁送致"]);
  const isBranched = progress != null && branched.has(progress);

  const steps = ["発生", "逮捕", "起訴", "一審判決", "控訴審", "確定"];
  let activeIdx = 0;
  if (progress === "確定" || latestStage === "確定") activeIdx = 5;
  else if (latestStage === "上告" || latestStage === "控訴" || hasAppealJudgment) activeIdx = 4;
  else if (progress === "判決後（未確定）" || latestStage === "判決") activeIdx = 3;
  else if (progress === "公判中" || latestStage === "起訴") activeIdx = 2;
  else if (latestStage === "逮捕" || latestStage === "再逮捕" || latestStage === "送検" || progress === "捜査中") activeIdx = 1;
  else activeIdx = 0;

  if (isBranched) {
    return html`
      <div class="stepper" aria-label="事件の進み具合">
        <div class="step done"><span class="step-dot"></span><span class="step-label">発生・捜査</span></div>
        <div class="step current"><span class="step-dot"></span><span class="step-label">${progress}</span></div>
      </div>
    `;
  }

  return html`
    <div class="stepper" aria-label="事件の進み具合">
      ${steps.map((label, idx) => {
        const cls = idx < activeIdx ? "done" : idx === activeIdx ? "current" : "";
        return html`<div class="step ${cls}"><span class="step-dot"></span><span class="step-label">${label}</span></div>`;
      })}
    </div>
  `;
}

/** 事件詳細 /cases/:id */
export async function renderCaseDetailPage(c: Context<{ Bindings: Env }>) {
  const id = c.req.param("id");
  const db = c.env.DB;
  const origin = new URL(c.req.url).origin;

  const kase = await db
    .prepare(
      `SELECT id, case_ref, title, summary, occurred_on, prefecture, city,
              is_juvenile, latest_stage, progress, latest_at, status, updated_at
       FROM cases WHERE id = ? OR case_ref = ?`,
    )
    .bind(id, id)
    .first<{
      id: string;
      case_ref: string;
      title: string;
      summary: string;
      occurred_on: string | null;
      prefecture: string | null;
      city: string | null;
      is_juvenile: number;
      latest_stage: string;
      progress: string | null;
      latest_at: string;
      status: string;
      updated_at: string;
    }>();

  if (!kase) {
    return c.html(
      renderLayout({
        title: "事件が見つかりません｜HANZAI Watch",
        activeNav: "cases",
        origin,
        noindex: true,
        body: html`<section class="card">
          <h1 class="page-h1">事件が見つかりません</h1>
          <p class="muted">指定された事件は存在しないか、URL が誤っています。</p>
          <a class="btn" href="/cases">事件一覧に戻る</a>
        </section>`,
      }),
      404,
    );
  }

  // 非公開の事件は 410 Gone（設計書 §4.2）
  if (kase.status !== "published") {
    return c.html(
      renderLayout({
        title: "この事件は非公開になりました｜HANZAI Watch",
        activeNav: "cases",
        origin,
        noindex: true,
        body: html`<section class="card">
          <h1 class="page-h1">この事件は非公開になりました</h1>
          <p class="muted">この事件のページは現在公開されていません。</p>
          <a class="btn" href="/cases">事件一覧に戻る</a>
        </section>`,
      }),
      410,
    );
  }

  const [
    themesRes,
    reportsRes,
    rChargesRes,
    personsRes,
    judgmentsRes,
    jChargesRes,
    judgesRes,
    victimsRes,
    periodsRes,
    distRes,
  ] = await db.batch([
    db.prepare("SELECT theme, source FROM case_themes WHERE case_id = ? ORDER BY theme").bind(kase.id),
    db
      .prepare(
        `SELECT id, stage, title, summary, reported_at, occurred_on, prefecture, city,
                police_agency, police_station, prosecutor_office, motive, weapon, accomplice_count,
                location_type, non_prosecution_reason, link_confidence, source_url, source_name, additional_sources
         FROM reports WHERE case_id = ? ORDER BY reported_at ASC`,
      )
      .bind(kase.id),
    db
      .prepare(
        `SELECT rc.report_id, rc.charge_text, rc.raw_text, rc.law_code, l.name AS law_name, l.law_name AS statute, rc.modifier
         FROM report_charges rc JOIN reports r ON r.id = rc.report_id
         LEFT JOIN laws l ON l.code = rc.law_code WHERE r.case_id = ? ORDER BY rc.seq`,
      )
      .bind(kase.id),
    db
      .prepare(
        `SELECT p.report_id, p.gender, p.age, p.age_group, p.juvenile_class, p.plea, p.occupation,
                p.nationality, p.residence_status, p.public_figure
         FROM report_persons p JOIN reports r ON r.id = p.report_id WHERE r.case_id = ? ORDER BY p.seq`,
      )
      .bind(kase.id),
    db
      .prepare(
        `SELECT j.id, j.court_id, co.name AS court_name, j.instance, j.decided_on, j.reported_at, j.occurred_on,
                j.link_confidence, j.lay_judge_trial, j.sentence_type, j.term_months,
                j.indeterminate_min_months, j.indeterminate_max_months, j.suspended_months, j.probation,
                j.fine_yen, j.detention_credit_days, j.other_dispositions, j.protective_disposition,
                j.demand_type, j.demand_months, j.demand_fine_yen, j.appeal_status,
                j.defendant_gender, j.gender_inherited, j.defendant_age, j.defendant_age_group, j.juvenile_class,
                j.defendant_occupation, j.defendant_nationality, j.nationality_inherited, j.defendant_residence_status,
                j.defendant_public_figure, j.plea, j.settlement, j.damage_yen, j.victim_count, j.harm_result,
                j.adjustments, j.primary_law_code, j.position_in_range, j.ratio_to_demand,
                j.title, j.summary, j.source_url, j.source_name, j.additional_sources,
                j.police_agency, j.prosecutor_office, j.motive, j.weapon, j.accomplice_count, j.location_type
         FROM judgments j JOIN courts co ON co.id = j.court_id
         WHERE j.case_id = ? AND j.status = 'published'
         ORDER BY j.decided_on ASC`,
      )
      .bind(kase.id),
    db
      .prepare(
        `SELECT jc.judgment_id, jc.charge_text, jc.raw_text, jc.law_code, l.name AS law_name, l.law_name AS statute,
                jc.modifier, jc.is_primary
         FROM judgment_charges jc JOIN judgments j ON j.id = jc.judgment_id
         LEFT JOIN laws l ON l.code = jc.law_code WHERE j.case_id = ? AND j.status = 'published' ORDER BY jc.seq`,
      )
      .bind(kase.id),
    db
      .prepare(
        `SELECT jj.judgment_id, jj.role, g.id AS judge_id, g.name
         FROM judgment_judges jj JOIN judges g ON g.id = jj.judge_id
         JOIN judgments j ON j.id = jj.judgment_id WHERE j.case_id = ? AND j.status = 'published'`,
      )
      .bind(kase.id),
    db
      .prepare(
        `SELECT v.parent_type, v.parent_id, v.gender, v.age_group, v.occupation, v.relation
         FROM victims v
         WHERE (v.parent_type = 'report' AND v.parent_id IN (SELECT id FROM reports WHERE case_id = ?1))
            OR (v.parent_type = 'judgment' AND v.parent_id IN (SELECT id FROM judgments WHERE case_id = ?1 AND status = 'published'))
         ORDER BY v.seq`,
      )
      .bind(kase.id),
    db.prepare(
      `SELECT law_code, effective_from, effective_to, statutory_penalty, stat_min_months, stat_max_months,
              stat_has_death, stat_has_life, verified
       FROM law_penalty_periods`,
    ),
    db.prepare("SELECT law_code, instance, n, p25_months, median_months, p75_months FROM agg_sentence_dist"),
  ]);

  const themeNames = [...new Set(((themesRes?.results ?? []) as { theme: string }[]).map((t) => t.theme))];

  type ReportRow = {
    id: string;
    stage: string;
    title: string;
    summary: string;
    reported_at: string;
    occurred_on: string | null;
    prefecture: string | null;
    city: string | null;
    police_agency: string | null;
    police_station: string | null;
    prosecutor_office: string | null;
    motive: string | null;
    weapon: string | null;
    accomplice_count: number | null;
    location_type: string | null;
    non_prosecution_reason: string | null;
    link_confidence: string | null;
    source_url: string;
    source_name: string | null;
    additional_sources: string | null;
  };
  const reports = (reportsRes?.results ?? []) as ReportRow[];

  type ChargeRow = {
    report_id?: string;
    judgment_id?: string;
    charge_text: string;
    raw_text: string;
    law_code: string | null;
    law_name: string | null;
    statute: string | null;
    modifier: string | null;
    is_primary?: number;
  };
  const rCharges = (rChargesRes?.results ?? []) as ChargeRow[];
  const jCharges = (jChargesRes?.results ?? []) as ChargeRow[];

  type PersonRow = {
    report_id: string;
    gender: string | null;
    age: number | null;
    age_group: string | null;
    juvenile_class: string | null;
    plea: string | null;
    occupation: string | null;
    nationality: string | null;
    residence_status: string | null;
    public_figure: string | null;
  };
  const persons = (personsRes?.results ?? []) as PersonRow[];

  type JudgRow = {
    id: string;
    court_name: string;
    instance: string | null;
    decided_on: string;
    reported_at: string | null;
    occurred_on: string | null;
    link_confidence: string | null;
    lay_judge_trial: number | null;
    sentence_type: string;
    term_months: number | null;
    indeterminate_min_months: number | null;
    indeterminate_max_months: number | null;
    suspended_months: number | null;
    probation: number | null;
    fine_yen: number | null;
    detention_credit_days: number | null;
    other_dispositions: string | null;
    protective_disposition: string | null;
    demand_type: string | null;
    demand_months: number | null;
    demand_fine_yen: number | null;
    appeal_status: string | null;
    defendant_gender: string | null;
    gender_inherited: number;
    defendant_age: number | null;
    defendant_age_group: string | null;
    juvenile_class: string | null;
    defendant_occupation: string | null;
    defendant_nationality: string | null;
    nationality_inherited: number;
    defendant_residence_status: string | null;
    defendant_public_figure: string | null;
    plea: string | null;
    settlement: string | null;
    damage_yen: number | null;
    victim_count: number | null;
    harm_result: string | null;
    adjustments: string | null;
    primary_law_code: string | null;
    position_in_range: number | null;
    ratio_to_demand: number | null;
    title: string;
    summary: string;
    source_url: string;
    source_name: string | null;
    additional_sources: string | null;
    police_agency: string | null;
    prosecutor_office: string | null;
    motive: string | null;
    weapon: string | null;
    accomplice_count: number | null;
    location_type: string | null;
  };
  const judgments = (judgmentsRes?.results ?? []) as JudgRow[];

  type JudgeRow = { judgment_id: string; role: string; judge_id: string; name: string };
  const judges = (judgesRes?.results ?? []) as JudgeRow[];

  type VictimRow = {
    parent_type: string;
    parent_id: string;
    gender: string | null;
    age_group: string | null;
    occupation: string | null;
    relation: string | null;
  };
  const victims = (victimsRes?.results ?? []) as VictimRow[];

  type PeriodRow = PenaltyPeriod & { statutory_penalty: string; verified: number };
  const periods = (periodsRes?.results ?? []) as PeriodRow[];

  type DistRow = {
    law_code: string;
    instance: string;
    n: number;
    p25_months: number | null;
    median_months: number | null;
    p75_months: number | null;
  };
  const distRows = (distRes?.results ?? []) as DistRow[];
  const findDist = (lawCode: string | null, instance: string | null): DistRow | null => {
    if (!lawCode) return null;
    return (
      distRows.find((d) => d.law_code === lawCode && d.instance === (instance ?? "*")) ??
      distRows.find((d) => d.law_code === lawCode && d.instance === "*") ??
      null
    );
  };

  // 著名人区分（最初に見つかったものを見出し前のバッジに表示）
  const publicFigure =
    judgments.find((j) => j.defendant_public_figure)?.defendant_public_figure ??
    persons.find((p) => p.public_figure)?.public_figure ??
    null;

  // 関連事件（同じテーマ／同じ都道府県）
  const relatedQueries: D1PreparedStatement[] = [];
  if (themeNames[0]) {
    relatedQueries.push(
      db
        .prepare(
          `SELECT c.id, c.title, c.prefecture, c.latest_stage, c.latest_at
           FROM cases c
           WHERE c.status = 'published' AND c.id <> ?
             AND EXISTS (SELECT 1 FROM case_themes ct WHERE ct.case_id = c.id AND ct.theme = ?)
           ORDER BY c.latest_at DESC LIMIT 4`,
        )
        .bind(kase.id, themeNames[0]),
    );
  }
  if (kase.prefecture) {
    relatedQueries.push(
      db
        .prepare(
          `SELECT id, title, prefecture, latest_stage, latest_at
           FROM cases WHERE status = 'published' AND id <> ? AND prefecture = ?
           ORDER BY latest_at DESC LIMIT 4`,
        )
        .bind(kase.id, kase.prefecture),
    );
  }
  const relatedResults = relatedQueries.length ? await db.batch(relatedQueries) : [];
  type RelRow = { id: string; title: string; prefecture: string | null; latest_stage: string; latest_at: string };
  const sameThemeCases = (themeNames[0] ? (relatedResults[0]?.results ?? []) : []) as RelRow[];
  const samePrefCases = (kase.prefecture ? (relatedResults[themeNames[0] ? 1 : 0]?.results ?? []) : []) as RelRow[];

  // 罪状の重複排除一覧（記事の表記 → 判定法律）
  const chargeMap = new Map<string, ChargeRow>();
  for (const ch of [...jCharges, ...rCharges]) {
    const key = `${ch.raw_text}\0${ch.law_code ?? ""}`;
    if (!chargeMap.has(key)) chargeMap.set(key, ch);
  }
  const uniqueCharges = [...chargeMap.values()];

  // 事件の状況（最新の値があるものをまとめる）
  const circumstances = {
    motive: judgments.find((j) => j.motive)?.motive ?? reports.find((r) => r.motive)?.motive ?? null,
    weapon: judgments.find((j) => j.weapon)?.weapon ?? reports.find((r) => r.weapon)?.weapon ?? null,
    accomplice_count:
      judgments.find((j) => j.accomplice_count != null)?.accomplice_count ??
      reports.find((r) => r.accomplice_count != null)?.accomplice_count ??
      null,
    location_type:
      judgments.find((j) => j.location_type)?.location_type ??
      reports.find((r) => r.location_type)?.location_type ??
      null,
  };
  const hasCircumstances = Object.values(circumstances).some((v) => v != null);

  // 時系列（報道 + 判決を日付順に並べる）
  type TimelineEntry = {
    kind: "report" | "judgment";
    date: string;
    stage: string;
    org: string[];
    summary: string;
    nonProsecutionReason?: string | null;
    linkConfidence?: string | null;
    sourceUrl: string;
    sourceName: string | null;
    additionalSources: { url: string; name?: string }[];
  };
  const parseExtraSources = (s: string | null): { url: string; name?: string }[] => {
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      return Array.isArray(parsed) ? parsed.filter((x) => x && typeof x.url === "string") : [];
    } catch {
      return [];
    }
  };
  const timeline: TimelineEntry[] = [
    ...reports.map((r) => ({
      kind: "report" as const,
      date: r.reported_at,
      stage: r.stage,
      org: [r.police_agency, r.police_station, r.prosecutor_office].filter((x): x is string => !!x),
      summary: r.summary,
      nonProsecutionReason: r.non_prosecution_reason,
      linkConfidence: r.link_confidence,
      sourceUrl: r.source_url,
      sourceName: r.source_name,
      additionalSources: parseExtraSources(r.additional_sources),
    })),
    ...judgments.map((j) => ({
      kind: "judgment" as const,
      date: j.decided_on,
      stage: j.instance ? `${j.instance}判決` : "判決",
      org: [j.court_name],
      summary: `${formatSentence(j)}${formatDemand(j) ? `（求刑 ${formatDemand(j)}）` : ""}`,
      linkConfidence: j.link_confidence,
      sourceUrl: j.source_url,
      sourceName: j.source_name,
      additionalSources: parseExtraSources(j.additional_sources),
    })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const finalized = isFinalized(kase.progress, kase.latest_stage);
  const hasAppealJudgment = judgments.some((j) => j.instance === "控訴審" || j.instance === "上告審");
  const canonicalPath = `/cases/${encodeURIComponent(kase.id)}`;
  const shareUrl = `${origin}${canonicalPath}`;
  const shareHashtags = ["HANZAIWatch", ...themeNames.slice(0, 2).map((t) => t.replace(/[・\s]/g, ""))]
    .map((h) => `#${h}`)
    .join(" ");
  const shareText = `${kase.title}（${kase.progress ?? kase.latest_stage}） ${shareHashtags}`;
  const xShareHref = `https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`;
  const lineShareHref = `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(shareUrl)}`;

  const firstJudg = judgments[0];
  const ogDesc =
    kase.summary.slice(0, 80) +
    (firstJudg ? `｜${formatSentence(firstJudg)}${formatDemand(firstJudg) ? `（求刑 ${formatDemand(firstJudg)}）` : ""}` : "");

  const body = html`
    <section class="card">
      <div class="pills" style="margin-bottom:10px">
        ${publicFigure ? html`<span class="pill pill-accent">某${publicFigure}</span>` : ""}
        ${themeNames.map((t) => html`<a class="pill" href="/themes/${encodeURIComponent(t)}">${t}</a>`)}
      </div>
      <h1 class="page-h1">${kase.title}</h1>
      <div class="feed-meta" style="margin-bottom:14px">
        <span>${kase.prefecture ?? "場所不明"}${kase.city ? ` ${kase.city}` : ""}</span>
        ${kase.occurred_on ? html`<span>・ ${formatDateJa(kase.occurred_on)}発生</span>` : ""}
        <span>・ 最終更新 <span class="num">${formatDateShort(kase.latest_at)}</span></span>
      </div>

      ${renderStepper(kase.progress, kase.latest_stage, hasAppealJudgment)}

      ${!finalized
        ? html`<div class="mt-12">
            <span class="presumption-box">有罪が確定したものではありません</span>
          </div>`
        : ""}

      <hr class="divider" />
      <h2 class="card-title" style="margin-bottom:8px">要約</h2>
      <p style="margin:0;color:var(--text-sub)">${kase.summary}</p>
    </section>

    ${judgments.map((j) => {
      const effDate = j.occurred_on ?? kase.occurred_on ?? j.decided_on;
      const period = j.primary_law_code ? (periodAt(periods, j.primary_law_code, effDate) as PeriodRow | null) : null;
      const dist = findDist(j.primary_law_code, j.instance);
      const bar = renderSentencingBar({
        sentenceType: j.sentence_type,
        termMonths: j.term_months,
        suspendedMonths: j.suspended_months,
        demandType: j.demand_type,
        demandMonths: j.demand_months,
        statMinMonths: period?.stat_min_months ?? null,
        statMaxMonths: period?.stat_max_months ?? null,
        statVerified: period?.verified ?? null,
        dist,
      });
      const jJudges = judges.filter((g) => g.judgment_id === j.id);
      const dem = formatDemand(j);
      const pleaLabel = formatPlea(j.plea);
      const settlementLabel = formatSettlement(j.settlement);
      const harmLabel = formatHarmResult(j.harm_result);
      let adjustments: string[] = [];
      if (j.adjustments) {
        try {
          const parsed = JSON.parse(j.adjustments);
          if (Array.isArray(parsed)) adjustments = parsed.map(String);
        } catch {
          /* ignore */
        }
      }
      const srcHref = safeHref(j.source_url);

      return html`<section class="card mt-16">
        <div class="feed-meta" style="margin-bottom:6px">
          <span class="pill pill-accent">${j.instance ? `${j.instance}判決` : "判決"}</span>
          <span>${j.court_name}</span>
          <span class="num">${formatDateJa(j.decided_on)}</span>
          ${j.lay_judge_trial ? html`<span class="pill">裁判員裁判</span>` : ""}
          ${j.appeal_status && j.appeal_status !== "不明" ? html`<span class="pill">控訴状況: ${j.appeal_status}</span>` : ""}
        </div>

        <div style="display:flex;flex-wrap:wrap;gap:14px 28px;align-items:baseline;margin:10px 0 12px">
          <div style="font-size:24px;font-weight:800;letter-spacing:-0.02em" class="num">${formatSentence(j)}</div>
          ${dem ? html`<div class="muted num" style="font-size:16px;font-weight:600">求刑 ${dem}</div>` : ""}
        </div>

        ${bar
          ? html`
              <div style="margin:12px 0 8px">${bar.svg}</div>
              <div class="pills mt-8">
                ${j.position_in_range != null
                  ? html`<span class="pill num">法定刑の幅の ${formatPct(j.position_in_range)}</span>`
                  : ""}
                ${j.ratio_to_demand != null
                  ? html`<span class="pill num">求刑の ${formatPct(j.ratio_to_demand)}</span>`
                  : ""}
                ${period?.statutory_penalty ? html`<span class="pill">法定刑: ${period.statutory_penalty}</span>` : ""}
              </div>
              ${bar.notes.length
                ? html`<div class="small muted mt-8">${bar.notes.join(" / ")}</div>`
                : ""}
            `
          : period?.statutory_penalty
            ? html`<div class="small muted">法定刑: ${period.statutory_penalty}</div>`
            : ""}

        <hr class="divider" />
        <dl class="kv">
          ${jJudges.length
            ? html`<dt>担当裁判官</dt>
                <dd>${jJudges.map((g) => `${g.role}: ${g.name}`).join(" ／ ")}</dd>`
            : ""}
          ${pleaLabel
            ? html`<dt>認否</dt>
                <dd>${pleaLabel}</dd>`
            : ""}
          ${settlementLabel
            ? html`<dt>示談</dt>
                <dd>${settlementLabel}</dd>`
            : ""}
          ${j.damage_yen != null
            ? html`<dt>被害額</dt>
                <dd class="num">${formatYen(j.damage_yen)}</dd>`
            : ""}
          ${j.victim_count != null
            ? html`<dt>被害者数</dt>
                <dd class="num">${j.victim_count}人</dd>`
            : ""}
          ${harmLabel
            ? html`<dt>被害の結果</dt>
                <dd>${harmLabel}</dd>`
            : ""}
          ${adjustments.length
            ? html`<dt>加重・減軽</dt>
                <dd>${adjustments.join("、")}</dd>`
            : ""}
          ${j.detention_credit_days != null
            ? html`<dt>未決勾留算入</dt>
                <dd class="num">${j.detention_credit_days}日</dd>`
            : ""}
          ${j.other_dispositions
            ? html`<dt>その他処分</dt>
                <dd>${j.other_dispositions}</dd>`
            : ""}
          <dt>出典</dt>
          <dd>
            ${srcHref
              ? html`<a href="${srcHref}" target="_blank" rel="noopener noreferrer">${j.source_name ?? j.source_url}</a>`
              : j.source_name ?? "記載なし"}
          </dd>
        </dl>
      </section>`;
    })}

    <div class="bento-equal">
      <section class="card">
        <h2 class="card-title">時系列</h2>
        ${timeline.length
          ? html`<ol class="timeline">
              ${timeline.map((ev) => {
                const href = safeHref(ev.sourceUrl);
                return html`<li class="tl-item ${ev.kind === "judgment" ? "is-judgment" : ""}">
                  <div class="tl-date">${formatDateShort(ev.date)}</div>
                  <div>
                    <span class="tl-stage">${ev.stage}</span>
                    ${ev.org.length ? html`<span class="small muted">${ev.org.join(" / ")}</span>` : ""}
                    ${ev.linkConfidence === "low"
                      ? html`<span class="pill" style="margin-left:4px">関連の可能性あり</span>`
                      : ""}
                  </div>
                  <p class="tl-body">${ev.summary}</p>
                  ${ev.nonProsecutionReason
                    ? html`<div class="small muted">不起訴理由: ${ev.nonProsecutionReason}</div>`
                    : ""}
                  <div class="small muted">
                    出典:
                    ${href
                      ? html`<a href="${href}" target="_blank" rel="noopener noreferrer">${ev.sourceName ?? "記事リンク"}</a>`
                      : ev.sourceName ?? "記載なし"}
                    ${ev.additionalSources.map((s) => {
                      const sh = safeHref(s.url);
                      return sh
                        ? html` ／ <a href="${sh}" target="_blank" rel="noopener noreferrer">${s.name ?? "関連報道"}</a>`
                        : "";
                    })}
                  </div>
                </li>`;
              })}
            </ol>`
          : html`<p class="muted small mb-0">時系列の記録はありません。</p>`}
      </section>

      <div style="display:flex;flex-direction:column;gap:16px">
        <section class="card">
          <h2 class="card-title">罪状と該当する法律</h2>
          ${uniqueCharges.length
            ? html`<ul class="feed">
                ${uniqueCharges.map((ch) => {
                  const mod = formatModifier(ch.modifier);
                  return html`<li class="feed-item" style="padding:8px 0">
                    <div style="font-weight:600">${ch.raw_text}${mod ? `（${mod}）` : ""}</div>
                    <div class="small muted">
                      →
                      ${ch.law_code && ch.law_name
                        ? html`<a href="/laws/${encodeURIComponent(ch.law_code)}">${ch.law_name}</a>${ch.statute
                            ? `（${ch.statute}）`
                            : ""}`
                        : "未分類"}
                    </div>
                  </li>`;
                })}
              </ul>`
            : html`<p class="muted small mb-0">罪状の記録はありません。</p>`}
        </section>

        <section class="card">
          <h2 class="card-title">被疑者・被告人の属性</h2>
          <p class="small muted" style="margin:-6px 0 12px">
            記事に記載された事実のみを表示しています。記載のない項目は「記載なし」とします（推測で補いません）。
          </p>
          ${judgments.length > 0
            ? judgments.map(
                (j, idx) => html`<div style="${idx > 0 ? "margin-top:12px;padding-top:12px;border-top:1px solid var(--line)" : ""}">
                  <div class="small muted" style="font-weight:600;margin-bottom:6px">被告人 ${judgments.length > 1 ? idx + 1 : ""}</div>
                  <dl class="kv">
                    <dt>性別</dt>
                    <dd>${formatGender(j.defendant_gender)}${j.gender_inherited ? "（報道から引き継ぎ）" : ""}</dd>
                    <dt>年齢</dt>
                    <dd class="num">${formatAge(j.defendant_age, j.defendant_age_group)}</dd>
                    ${formatJuvenileClass(j.juvenile_class)
                      ? html`<dt>区分</dt>
                          <dd>${formatJuvenileClass(j.juvenile_class)}</dd>`
                      : ""}
                    <dt>職業</dt>
                    <dd>${j.defendant_occupation ?? "記載なし"}</dd>
                    <dt>国籍</dt>
                    <dd>
                      ${j.defendant_nationality ?? "記載なし"}${j.nationality_inherited ? "（報道から引き継ぎ）" : ""}
                    </dd>
                    ${j.defendant_residence_status
                      ? html`<dt>在留資格</dt>
                          <dd>${j.defendant_residence_status}</dd>`
                      : ""}
                    ${j.defendant_public_figure
                      ? html`<dt>著名人区分</dt>
                          <dd>某${j.defendant_public_figure}</dd>`
                      : ""}
                  </dl>
                </div>`,
              )
            : persons.length > 0
              ? persons.map(
                  (p, idx) => html`<div style="${idx > 0 ? "margin-top:12px;padding-top:12px;border-top:1px solid var(--line)" : ""}">
                    <div class="small muted" style="font-weight:600;margin-bottom:6px">被疑者 ${persons.length > 1 ? idx + 1 : ""}</div>
                    <dl class="kv">
                      <dt>性別</dt>
                      <dd>${formatGender(p.gender)}</dd>
                      <dt>年齢</dt>
                      <dd class="num">${formatAge(p.age, p.age_group)}</dd>
                      ${formatJuvenileClass(p.juvenile_class)
                        ? html`<dt>区分</dt>
                            <dd>${formatJuvenileClass(p.juvenile_class)}</dd>`
                        : ""}
                      <dt>職業</dt>
                      <dd>${p.occupation ?? "記載なし"}</dd>
                      <dt>国籍</dt>
                      <dd>${p.nationality ?? "記載なし"}</dd>
                      ${p.residence_status
                        ? html`<dt>在留資格</dt>
                            <dd>${p.residence_status}</dd>`
                        : ""}
                      ${formatPlea(p.plea)
                        ? html`<dt>認否</dt>
                            <dd>${formatPlea(p.plea)}</dd>`
                        : ""}
                      ${p.public_figure
                        ? html`<dt>著名人区分</dt>
                            <dd>某${p.public_figure}</dd>`
                        : ""}
                    </dl>
                  </div>`,
                )
              : html`<p class="muted small mb-0">属性の記録はありません。</p>`}
        </section>

        ${victims.length || hasCircumstances
          ? html`<section class="card">
              ${victims.length
                ? html`<h2 class="card-title">被害者（大まかな属性のみ）</h2>
                    <ul class="feed">
                      ${victims.map(
                        (v) => html`<li class="feed-item" style="padding:6px 0">
                          <div class="small">
                            ${[
                              v.gender ? formatGender(v.gender) : null,
                              v.age_group,
                              v.occupation,
                              v.relation ? `関係: ${v.relation}` : null,
                            ]
                              .filter(Boolean)
                              .join(" ・ ") || "記載なし"}
                          </div>
                        </li>`,
                      )}
                    </ul>`
                : ""}
              ${hasCircumstances
                ? html`<h2 class="card-title ${victims.length ? "mt-16" : ""}">事件の状況</h2>
                    <dl class="kv">
                      ${circumstances.motive ? html`<dt>動機</dt><dd>${circumstances.motive}</dd>` : ""}
                      ${circumstances.weapon ? html`<dt>凶器</dt><dd>${circumstances.weapon}</dd>` : ""}
                      ${circumstances.accomplice_count != null
                        ? html`<dt>共犯者数</dt><dd class="num">${circumstances.accomplice_count}人</dd>`
                        : ""}
                      ${circumstances.location_type ? html`<dt>場所種別</dt><dd>${circumstances.location_type}</dd>` : ""}
                    </dl>`
                : ""}
            </section>`
          : ""}
      </div>
    </div>

    ${sameThemeCases.length || samePrefCases.length
      ? html`<div class="bento-equal">
          ${sameThemeCases.length
            ? html`<section class="card">
                <h2 class="card-title">
                  <span>同じテーマの最近の事件（${themeNames[0]}）</span>
                  <a class="small" href="/themes/${encodeURIComponent(themeNames[0]!)}">一覧 →</a>
                </h2>
                <ul class="feed">
                  ${sameThemeCases.map(
                    (r) => html`<li class="feed-item">
                      <div class="feed-meta">
                        <span class="pill">${r.latest_stage}</span>
                        <span>${r.prefecture ?? "場所不明"}</span>
                        <span class="num">${formatDateShort(r.latest_at)}</span>
                      </div>
                      <a class="feed-title" href="/cases/${encodeURIComponent(r.id)}">${r.title}</a>
                    </li>`,
                  )}
                </ul>
              </section>`
            : ""}
          ${samePrefCases.length
            ? html`<section class="card">
                <h2 class="card-title">
                  <span>同じ都道府県の最近の事件（${kase.prefecture}）</span>
                  <a class="small" href="/prefectures/${encodeURIComponent(kase.prefecture!)}">一覧 →</a>
                </h2>
                <ul class="feed">
                  ${samePrefCases.map(
                    (r) => html`<li class="feed-item">
                      <div class="feed-meta">
                        <span class="pill">${r.latest_stage}</span>
                        <span class="num">${formatDateShort(r.latest_at)}</span>
                      </div>
                      <a class="feed-title" href="/cases/${encodeURIComponent(r.id)}">${r.title}</a>
                    </li>`,
                  )}
                </ul>
              </section>`
            : ""}
        </div>`
      : ""}

    <section class="card mt-16">
      <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;align-items:center">
        <div class="pills">
          <a class="btn" href="${xShareHref}" target="_blank" rel="noopener noreferrer">X でシェア</a>
          <a class="btn" href="${lineShareHref}" target="_blank" rel="noopener noreferrer">LINE で送る</a>
          <a class="btn" href="/cases/${encodeURIComponent(kase.id)}/feed.xml">この事件の続報 RSS</a>
        </div>
        <a class="btn" href="/contact?case=${encodeURIComponent(kase.id)}">この事件の訂正・削除を依頼</a>
      </div>
    </section>
  `;

  return c.html(
    renderLayout({
      title: `${kase.title}｜${kase.prefecture ?? "日本"}・${kase.progress ?? kase.latest_stage}｜HANZAI Watch`,
      description: ogDesc,
      activeNav: "cases",
      canonicalPath,
      origin,
      ogType: "article",
      ogImagePath: themeNames[0] ? `/og/theme/${encodeURIComponent(themeNames[0])}.svg` : "/og/default.svg",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: kase.title,
        description: ogDesc,
        url: shareUrl,
        dateModified: kase.updated_at,
      },
      body,
    }),
  );
}
