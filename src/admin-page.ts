// 管理画面（/admin）。ページ自体にデータは含まず、閲覧 API をトークン付きで呼び出す。
import { THEMES } from "./themes";

export const ADMIN_PAGE = /* html */ `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Crime Watch 管理</title>
<style>
:root {
  --bg: #f6f7f9; --panel: #ffffff; --text: #1d2330; --muted: #5d6677; --line: #e1e4ea;
  --accent: #2f5bd3; --accent-weak: #e7edfb; --warn: #b4540a; --warn-weak: #fdf0e3;
  --ok: #1f7a4d; --danger: #b42318; --danger-weak: #fdecea; --mark: #fff2b3;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #12151b; --panel: #1b2029; --text: #e6e9ef; --muted: #9aa3b2; --line: #2c3340;
    --accent: #7c9cf0; --accent-weak: #232c44; --warn: #f0a35e; --warn-weak: #3a2a1a;
    --ok: #5cc493; --danger: #f17b6f; --danger-weak: #3d1f1d; --mark: #5a4b12;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.6 system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif; }
header { background: var(--panel); border-bottom: 1px solid var(--line); padding: 12px 16px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
header h1 { font-size: 16px; margin: 0 12px 0 0; }
nav { display: flex; gap: 4px; flex-wrap: wrap; }
nav button { background: none; border: 0; padding: 6px 12px; border-radius: 6px; color: var(--muted); cursor: pointer; font: inherit; }
nav button.on { background: var(--accent-weak); color: var(--accent); font-weight: 600; }
.badge { display: inline-block; min-width: 18px; padding: 0 6px; border-radius: 9px; background: var(--warn-weak); color: var(--warn); font-size: 12px; text-align: center; }
main { max-width: 1200px; margin: 0 auto; padding: 16px; }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
.panel h2 { font-size: 15px; margin: 0 0 12px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
.stat .v { font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; }
.stat .k { color: var(--muted); font-size: 12px; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 500; font-size: 12px; white-space: nowrap; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
tr.click { cursor: pointer; } tr.click:hover { background: var(--accent-weak); }
.bar { height: 8px; background: var(--line); border-radius: 4px; overflow: hidden; min-width: 80px; }
.bar > i { display: block; height: 100%; background: var(--accent); }
input, select, button.btn { font: inherit; padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); color: var(--text); }
button.btn { cursor: pointer; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button.danger { color: var(--danger); border-color: var(--danger); }
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; }
.muted { color: var(--muted); }
.tag { display: inline-block; padding: 0 6px; border-radius: 4px; font-size: 12px; background: var(--accent-weak); color: var(--accent); margin-right: 4px; }
.tag.warn { background: var(--warn-weak); color: var(--warn); }
.tag.danger { background: var(--danger-weak); color: var(--danger); }
mark { background: var(--mark); color: inherit; border-radius: 2px; }
.timeline { border-left: 2px solid var(--line); margin-left: 6px; padding-left: 16px; }
.ev { position: relative; margin-bottom: 16px; }
.ev::before { content: ""; position: absolute; left: -22px; top: 6px; width: 10px; height: 10px; border-radius: 50%; background: var(--accent); }
.ev.judgment::before { background: var(--ok); }
.ev .when { color: var(--muted); font-size: 12px; }
dl.kv { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 6px 0 0; font-size: 13px; }
dl.kv dt { color: var(--muted); }
dl.kv dd { margin: 0; }
#detail { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: none; }
#detail .sheet { position: absolute; right: 0; top: 0; bottom: 0; width: min(720px, 100%); background: var(--bg); overflow-y: auto; padding: 16px; }
.err { color: var(--danger); }
a { color: var(--accent); }
@media (max-width: 640px) { th.hide-sm, td.hide-sm { display: none; } }
</style>
</head>
<body>
<header>
  <h1>Crime Watch 管理</h1>
  <nav id="tabs">
    <button data-tab="stats" class="on">集計</button>
    <button data-tab="cases">事件</button>
    <button data-tab="prefs">都道府県</button>
    <button data-tab="nats">国籍</button>
    <button data-tab="flagged">要確認 <span class="badge" id="flagCount">–</span></button>
    <button data-tab="unclassified">未分類の罪状 <span class="badge" id="uncCount">–</span></button>
  </nav>
  <span style="flex:1"></span>
  <form id="tokenForm" class="row" style="margin:0">
    <input id="token" type="password" placeholder="閲覧用トークン" autocomplete="off" size="18">
    <button class="btn" type="submit">接続</button>
  </form>
</header>
<main>
  <div id="msg"></div>
  <section id="tab-stats"></section>
  <section id="tab-cases" hidden>
    <div class="panel">
      <form id="caseFilter" class="row">
        <input name="q" placeholder="見出し・要約・case_ref で検索" size="28">
        <select name="law"><option value="">すべての法律</option></select>
        <select name="prefecture"><option value="">すべての都道府県</option></select>
        <select name="status">
          <option value="all">公開・非公開すべて</option>
          <option value="">公開中のみ</option>
          <option value="hidden">非公開のみ</option>
        </select>
        <select name="theme">
          <option value="">すべてのテーマ</option>
          ${THEMES.map((t) => `<option>${t}</option>`).join("")}
        </select>
        <select name="progress">
          <option value="">すべての進み具合</option>
          <option>捜査中</option><option>処分保留</option><option>公判中</option><option>略式手続</option>
          <option>判決後（未確定）</option><option>確定</option><option>不起訴</option><option>家裁送致</option>
        </select>
        <label><input type="checkbox" name="flagged" value="1"> 要確認のみ</label>
        <input type="hidden" name="pref_basis" value="">
        <button class="btn primary" type="submit">検索</button>
      </form>
      <div id="caseList"></div>
    </div>
  </section>
  <section id="tab-prefs" hidden>
    <div class="panel">
      <form id="prefFilter" class="row">
        <label>基準
          <select name="basis">
            <option value="occurrence">発生地</option>
            <option value="police">捜査した警察</option>
            <option value="court">判決の裁判所</option>
          </select>
        </label>
        <label>期間 <input type="date" name="from"> 〜 <input type="date" name="to"></label>
        <select name="law"><option value="">すべての法律</option></select>
        <select name="sort">
          <option value="cases">件数の多い順</option>
          <option value="code">都道府県コード順</option>
        </select>
        <label><input type="checkbox" name="hideZero" value="1" checked> 0件を隠す</label>
        <button class="btn primary" type="submit">集計</button>
        <button class="btn" type="button" id="prefCsv">CSV</button>
      </form>
      <p class="muted" style="margin:0 0 8px">件数は収集した報道・判決にもとづくもので、全国の認知件数ではありません（報道されやすい事件に偏ります）。人口あたりの補正はしていません。判決の指標は件数（n）が少ない都道府県ほどぶれが大きいので、n が 5 未満の値は薄く表示しています。行を押すと、その都道府県の事件一覧を開きます。</p>
      <div id="prefTable"></div>
    </div>
  </section>
  <section id="tab-nats" hidden>
    <div class="panel">
      <form id="natFilter" class="row">
        <label>期間 <input type="date" name="from"> 〜 <input type="date" name="to"></label>
        <select name="law"><option value="">すべての法律</option></select>
        <select name="prefecture"><option value="">すべての都道府県（発生地）</option></select>
        <button class="btn primary" type="submit">集計</button>
        <button class="btn" type="button" id="natCsv">CSV</button>
      </form>
      <p class="muted" style="margin:0 0 8px">数える単位は人（同じ事件の同じ人物は 1 人）です。国籍は記事に明記されたものだけを数え、書かれていない人は「記載なし」にしています（日本国籍とはみなしません）。報道は外国籍のときに国籍を書くことが多いため、外国籍の割合は実際より高く見えます。人口あたりの補正はしていません。来日外国人・定着居住者の区分は警察庁の統計に合わせています。</p>
      <div id="natTable"></div>
    </div>
  </section>
  <section id="tab-flagged" hidden></section>
  <section id="tab-unclassified" hidden></section>
</main>
<div id="detail"><div class="sheet" id="detailBody"></div></div>

<script>
(() => {
  const PREFS = ["北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県","新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県","静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県","鳥取県","島根県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県","福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"];
  const FLAG_LABEL = { person_name: "人名らしき表記", phone: "電話番号", street_address: "番地", school: "学校名", juvenile_detail: "少年の年齢", victim_age: "正確な年齢（性犯罪）", victim_relation: "近しい関係（性犯罪）" };
  const GENDER = { male: "男性", female: "女性", unknown: "不明" };
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const pct = (v) => (v == null ? "–" : Math.round(v * 100) + "%");
  const months = (m) => { if (m == null) return ""; const y = Math.floor(m / 12), r = m % 12; return (y ? y + "年" : "") + (r ? r + "月" : (y ? "" : "0月")); };
  let token = "";
  try { token = sessionStorage.getItem("cw_token") || ""; } catch {}
  let laws = [];

  async function api(path, opts = {}) {
    const res = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, ...(opts.headers || {}) } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(res.status === 401 ? "トークンが違います" : (body.error || res.status));
    return body;
  }
  function msg(text, isErr) { $("#msg").innerHTML = text ? '<div class="panel ' + (isErr ? "err" : "") + '">' + esc(text) + "</div>" : ""; }
  const lawName = (code) => (laws.find((l) => l.code === code) || {}).name || code || "未分類";

  // タブ
  $("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]"); if (!b) return;
    document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("on", x === b));
    document.querySelectorAll("main > section").forEach((s) => (s.hidden = s.id !== "tab-" + b.dataset.tab));
    load(b.dataset.tab);
  });

  $("#tokenForm").addEventListener("submit", (e) => {
    e.preventDefault(); token = $("#token").value.trim();
    try { sessionStorage.setItem("cw_token", token); } catch {}
    init();
  });

  async function init() {
    if (!token) { msg("閲覧用トークン（VIEWER_TOKEN）を入力してください。"); return; }
    try {
      laws = (await api("/api/v1/laws")).laws;
      const lawOpts = '<option value="">すべての法律</option>' + laws.map((l) => '<option value="' + esc(l.code) + '">' + esc(l.name) + "</option>").join("");
      $("#caseFilter select[name=law]").innerHTML = lawOpts;
      $("#prefFilter select[name=law]").innerHTML = lawOpts;
      $("#natFilter select[name=law]").innerHTML = lawOpts;
      $("#natFilter select[name=prefecture]").innerHTML = '<option value="">すべての都道府県（発生地）</option>' + PREFS.map((p) => "<option>" + p + "</option>").join("");
      $("#caseFilter select[name=prefecture]").innerHTML = '<option value="">すべての都道府県</option>' + PREFS.concat(["不明"]).map((p) => "<option>" + p + "</option>").join("");
      msg("");
      await load("stats");
      refreshBadges();
    } catch (err) { msg(String(err.message || err), true); }
  }

  async function refreshBadges() {
    try {
      const [f, s] = await Promise.all([api("/api/v1/admin/flagged"), api("/api/v1/admin/trial-stats")]);
      $("#flagCount").textContent = f.items.length;
      $("#uncCount").textContent = s.top_unclassified.length;
    } catch {}
  }

  async function load(tab) {
    if (!token) return;
    try {
      if (tab === "stats") await renderStats();
      if (tab === "cases") await renderCases();
      if (tab === "prefs") await renderPrefs();
      if (tab === "nats") await renderNats();
      if (tab === "flagged") await renderFlagged();
      if (tab === "unclassified") await renderUnclassified();
    } catch (err) { msg(String(err.message || err), true); }
  }

  // ===== 集計 =====
  async function renderStats() {
    const s = await api("/api/v1/admin/trial-stats");
    const t = s.totals, f = s.judgment_fill_rates;
    const fillRows = [["求刑", f.demand], ["裁判官（誰か）", f.any_judge], ["裁判長・単独の裁判官", f.presiding_judge], ["性別", f.gender], ["うち逮捕報道から引き継ぎ", f.gender_inherited], ["年齢・年代", f.age], ["審級", f.instance], ["裁判員裁判か", f.lay_judge_trial], ["認否", f.plea], ["被害額", f.damage_yen], ["被害の結果", f.harm_result], ["法定刑内の位置（計算できた割合）", f.position_in_range], ["求刑比（計算できた割合）", f.ratio_to_demand]];
    $("#tab-stats").innerHTML =
      '<div class="panel"><h2>件数</h2><div class="grid">' +
      [["事件", t.cases], ["報道", t.reports], ["うち過去分", t.reports_backfill], ["判決", t.judgments], ["うち過去分", t.judgments_backfill], ["裁判官", t.judges], ["裁判所", t.courts]]
        .map(([k, v]) => '<div class="stat"><div class="v">' + esc(v ?? 0) + '</div><div class="k">' + k + "</div></div>").join("") +
      '</div></div>' +
      '<div class="panel"><h2>判決の項目ごとの取れた割合（' + esc(f.n ?? 0) + ' 件中）</h2><table><tbody>' +
      fillRows.map(([k, v]) => "<tr><td>" + k + '</td><td class="num" style="width:60px">' + pct(v) + '</td><td style="width:40%"><div class="bar"><i style="width:' + Math.round((v || 0) * 100) + '%"></i></div></td></tr>').join("") +
      "</tbody></table></div>" +
      '<div class="panel"><h2>罪状の判定</h2><p>罪状 ' + esc(s.charges.total) + " 件のうち、未分類 " + esc(s.charges.unclassified) + " 件（" + pct(s.charges.unclassified_rate) + "）。要確認（未確認）" + esc((s.flagged.reports || 0) + (s.flagged.judgments || 0)) + " 件、確認済み " + esc(s.flagged.reviewed || 0) + " 件。</p>" +
      '<p class="muted">法律マスタ・罪状辞書を D1 コンソールで更新したときや、アプリの更新で判定・自動チェックのルールが変わったときは、保存済みのデータに反映させるため、次のボタンを押してください。</p>' +
      '<div class="row" style="margin:0"><button class="btn" id="btnReclassify">罪状を判定し直す</button><button class="btn" id="btnRescan">自動チェックをやり直す</button><span class="muted" id="maintMsg"></span></div></div>' +
      '<div class="panel"><h2>テーマ別</h2><p class="muted">データから自動で判定したものと、Muse が記事から付けたもの（✎）の合計です。テーマを押すと、そのテーマの事件一覧を開きます。</p>' +
      (s.themes.length === 0 ? '<p class="muted">まだありません。</p>' :
        '<div class="row">' + s.themes.map((t) => '<a href="#" class="tag" data-theme="' + esc(t.theme) + '">#' + esc(t.theme) + " " + t.cases + (t.muse ? " ✎" + t.muse : "") + "</a>").join("") + "</div>") +
      '<div class="row" style="margin:8px 0 0"><button class="btn" id="btnThemes">テーマを付け直す</button></div></div>' +
      '<div class="panel"><h2>法律別</h2><table><thead><tr><th>法律</th><th class="num">事件（報道）</th><th class="num">判決</th></tr></thead><tbody>' +
      s.by_law.map((r) => "<tr><td>" + esc(r.name) + '</td><td class="num">' + esc(r.report_cases) + '</td><td class="num">' + esc(r.judgments) + "</td></tr>").join("") +
      "</tbody></table></div>" +
      '<div class="panel"><h2>受信（日ごと）</h2><table><thead><tr><th>日付</th><th class="num">件数</th><th class="num">新規</th><th class="num">更新</th><th class="num">拒否</th><th class="num">要確認</th></tr></thead><tbody>' +
      s.daily_ingest.map((d) => "<tr><td>" + esc(d.day) + '</td><td class="num">' + esc(d.items) + '</td><td class="num">' + esc(d.created) + '</td><td class="num">' + esc(d.updated) + '</td><td class="num">' + esc(d.rejected) + '</td><td class="num">' + esc(d.flagged) + "</td></tr>").join("") +
      "</tbody></table></div>";
    const run = async (btn, path, label) => {
      btn.disabled = true;
      $("#maintMsg").textContent = label + "中…";
      try {
        const r = await api(path, { method: "POST" });
        const L = { changed: "変わった件数", judgments_recomputed: "計算し直した判決", checked: "確認した件数", flagged: "要確認", themes: "テーマの数" };
        $("#maintMsg").textContent = label + "が終わりました（" + Object.entries(r).map(([k, v]) => (L[k] || k) + " " + v).join("、") + "）";
        refreshBadges();
      } catch (err) { $("#maintMsg").textContent = label + "に失敗しました：" + (err.message || err); }
      btn.disabled = false;
    };
    $("#btnReclassify").onclick = (e) => run(e.target, "/api/v1/admin/reclassify", "罪状の判定し直し");
    $("#btnRescan").onclick = (e) => run(e.target, "/api/v1/admin/rescan-flags", "自動チェックのやり直し");
    $("#btnThemes").onclick = async (e) => { await run(e.target, "/api/v1/admin/recompute-themes", "テーマの付け直し"); renderStats(); };
  }

  // ===== 事件 =====
  $("#caseFilter").addEventListener("submit", (e) => { e.preventDefault(); renderCases(); });
  // 確定・不起訴などで終わっていない事件は、最後の報道・判決からの日数を添える（長く動きのない事件を見つけるため）
  const OPEN_PROGRESS = ["捜査中", "処分保留", "公判中", "略式手続", "判決後（未確定）"];
  function daysSince(c) {
    if (!OPEN_PROGRESS.includes(c.progress) || !c.latest_at) return "";
    const d = Math.floor((Date.now() - Date.parse(c.latest_at)) / 86400000);
    return d >= 30 ? ' <span class="muted">（' + d + "日）</span>" : "";
  }
  // 都道府県を手で選び直したら、発生地の基準に戻す
  $("#caseFilter select[name=prefecture]").addEventListener("change", () => { $("#caseFilter input[name=pref_basis]").value = ""; });
  async function renderCases() {
    const fd = new FormData($("#caseFilter"));
    const p = new URLSearchParams({ limit: "200" });
    for (const [k, v] of fd) if (v) p.set(k, v);
    if (!fd.get("status")) p.delete("status");
    if (fd.get("status") === "") p.delete("status");
    const statusSel = $("#caseFilter select[name=status]").value;
    if (statusSel) p.set("status", statusSel);
    const r = await api("/api/v1/cases?" + p);
    const basis = fd.get("pref_basis");
    const note = fd.get("prefecture") && basis && basis !== "occurrence"
      ? '<p class="muted">都道府県は「' + esc(BASIS_LABEL[basis]) + "」の基準で絞り込んでいます（一覧の都道府県の列は発生地です）。</p>" : "";
    $("#caseList").innerHTML = note + (r.cases.length === 0 ? '<p class="muted">該当する事件はありません。</p>' :
      '<table><thead><tr><th>最新</th><th>段階</th><th class="hide-sm">進み具合</th><th>見出し</th><th class="hide-sm">都道府県</th><th></th></tr></thead><tbody>' +
      r.cases.map((c) => '<tr class="click" data-id="' + esc(c.id) + '"><td>' + esc((c.latest_at || "").slice(0, 10)) + "</td><td>" + esc(c.latest_stage) +
        '</td><td class="hide-sm">' + esc(c.progress || "") + daysSince(c) + "</td><td>" + esc(c.title) +
        '</td><td class="hide-sm">' + esc(c.prefecture) + (c.city ? " " + esc(c.city) : "") + "</td><td>" +
        (c.flagged ? '<span class="tag warn">要確認</span>' : "") + (c.status === "hidden" ? '<span class="tag danger">非公開</span>' : "") +
        (c.is_juvenile ? '<span class="tag">少年</span>' : "") + (c.backfill ? '<span class="tag">過去分</span>' : "") +
        (c.themes || []).map((t) => '<span class="tag">#' + esc(t) + "</span>").join("") + "</td></tr>").join("") +
      "</tbody></table>");
  }
  document.addEventListener("click", (e) => {
    const tr = e.target.closest("tr.click[data-id], a[data-case]");
    if (tr) { e.preventDefault(); openCase(tr.dataset.id || tr.dataset.case); }
  });
  $("#detail").addEventListener("click", (e) => { if (e.target.id === "detail" || e.target.closest("[data-close]")) $("#detail").style.display = "none"; });

  function highlight(text, flags) {
    let out = esc(text);
    for (const f of flags || []) { const m = esc(f.match); if (m) out = out.split(m).join("<mark>" + m + "</mark>"); }
    return out;
  }
  function flagTags(flags) { return (flags || []).map((f) => '<span class="tag warn">' + esc(FLAG_LABEL[f.kind] || f.kind) + "：" + esc(f.match) + "</span>").join(""); }
  const parse = (v) => { try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; } };
  // 事件の状況・被害者（どちらも粗い分類）
  function extraRows(x) {
    const circ = [x.motive && "動機：" + x.motive, x.weapon && "凶器：" + x.weapon, x.location_type && "場所：" + x.location_type,
      x.accomplice_count != null && (x.accomplice_count === 0 ? "単独" : "共犯者 " + x.accomplice_count + " 人")].filter(Boolean).join("、");
    const vic = (x.victims || []).map((v) => [GENDER[v.gender] || "", v.age_group || "", v.occupation || "", v.relation ? "（" + v.relation + "）" : ""].join("")).filter(Boolean).join(" / ");
    return (circ ? "<dt>状況</dt><dd>" + esc(circ) + "</dd>" : "") + (vic ? "<dt>被害者</dt><dd>" + esc(vic) + "</dd>" : "");
  }

  async function openCase(id) {
    const d = await api("/api/v1/cases/" + encodeURIComponent(id));
    const k = d.case;
    const events = [
      ...d.reports.map((r) => ({ kind: "report", at: r.reported_at, r })),
      ...d.judgments.map((j) => ({ kind: "judgment", at: j.decided_on + "T23:59:59+09:00", j })),
    ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const charges = (list) => list.map((c) => '<span class="tag' + (c.law_code ? "" : " warn") + '">' + esc(c.charge_text) + (c.modifier ? "（" + esc({ attempt: "未遂", accessory: "ほう助", instigation: "教唆" }[c.modifier] || c.modifier) + "）" : "") + " → " + esc(c.law_name || "未分類") + (c.is_primary ? " ★" : "") + "</span>").join("");
    const evHtml = events.map((e) => {
      if (e.kind === "report") {
        const r = e.r, flags = parse(r.flags);
        const sus = (r.suspects || []).map((p) => [GENDER[p.gender] || "", p.age != null ? p.age + "歳" : p.age_group || "", p.occupation || "",
          p.nationality ? p.nationality + "国籍" + (p.residence_status ? "（" + p.residence_status + "）" : "") : (p.residence_status || ""),
          p.public_figure ? "著名人（某" + p.public_figure + "）" : "", p.plea ? { admit: "認めている", deny: "否認", partial: "一部否認", unknown: "" }[p.plea] : ""].filter(Boolean).join("・")).filter(Boolean).join(" / ");
        return '<div class="ev"><div class="when">' + esc(r.reported_at.slice(0, 16).replace("T", " ")) + " 報道（" + esc(r.stage) + ")" + (r.link_confidence === "low" ? ' <span class="tag warn">ひも付けの確度：低</span>' : "") + "</div>" +
          "<div><b>" + highlight(r.title, flags) + "</b></div><div>" + highlight(r.summary, flags) + "</div>" + flagTags(flags) +
          '<dl class="kv">' +
          "<dt>罪状</dt><dd>" + charges(r.charges) + "</dd>" +
          "<dt>発生</dt><dd>" + esc([r.occurred_on, r.prefecture, r.city].filter(Boolean).join(" ")) + "</dd>" +
          (r.police_agency || r.police_station ? "<dt>警察</dt><dd>" + esc([r.police_agency, r.police_station].filter(Boolean).join(" ")) + "</dd>" : "") +
          (r.prosecutor_office ? "<dt>検察</dt><dd>" + esc(r.prosecutor_office) + "</dd>" : "") +
          (r.non_prosecution_reason ? "<dt>不起訴の理由</dt><dd>" + esc(r.non_prosecution_reason) + "</dd>" : "") +
          (sus ? "<dt>被疑者</dt><dd>" + esc(sus) + "</dd>" : "") + extraRows(r) +
          '<dt>出典</dt><dd><a href="' + esc(r.source_url) + '" target="_blank" rel="noopener noreferrer">' + esc(r.source_name || r.source_url) + "</a></dd></dl></div>";
      }
      const j = e.j, flags = parse(j.flags);
      const sentence = esc(j.sentence_type) + (j.term_months != null ? " " + months(j.term_months) : "") + (j.suspended_months ? "・執行猶予" + months(j.suspended_months) + (j.probation ? "（保護観察付き）" : "") : "") + (j.fine_yen ? "・罰金" + Number(j.fine_yen).toLocaleString() + "円" : "");
      const demand = j.demand_type ? esc(j.demand_type) + (j.demand_months != null ? " " + months(j.demand_months) : "") : "";
      const judges = (j.judges || []).map((g) => esc(g.name) + "（" + esc(g.role) + "）").join("、");
      const def = [GENDER[j.defendant_gender] ? GENDER[j.defendant_gender] + (j.gender_inherited ? "（逮捕報道から）" : "") : "", j.defendant_age != null ? j.defendant_age + "歳" : j.defendant_age_group || "", j.defendant_occupation || "",
        j.defendant_public_figure ? "著名人（某" + j.defendant_public_figure + "）" : "",
        j.defendant_nationality ? j.defendant_nationality + "国籍" + (j.defendant_residence_status ? "（" + j.defendant_residence_status + "）" : "") + (j.nationality_inherited ? "（逮捕報道から）" : "") : ""].filter(Boolean).join("・");
      return '<div class="ev judgment"><div class="when">' + esc(j.decided_on) + " 判決" + (j.instance ? "（" + esc(j.instance) + "）" : "") + " " + esc(j.court_name) + (j.lay_judge_trial ? ' <span class="tag">裁判員裁判</span>' : "") + "</div>" +
        "<div><b>" + highlight(j.title, flags) + "</b></div><div>" + highlight(j.summary, flags) + "</div>" + flagTags(flags) +
        '<dl class="kv">' +
        "<dt>罪状</dt><dd>" + charges(j.charges) + "</dd>" +
        "<dt>刑</dt><dd>" + sentence + "</dd>" +
        (demand ? "<dt>求刑</dt><dd>" + demand + (j.ratio_to_demand != null ? "（求刑比 " + pct(j.ratio_to_demand) + "）" : "") + "</dd>" : "") +
        (j.position_in_range != null ? "<dt>法定刑内の位置</dt><dd>" + pct(j.position_in_range) + "</dd>" : "") +
        (judges ? "<dt>裁判官</dt><dd>" + judges + "</dd>" : "") +
        (def ? "<dt>被告人</dt><dd>" + esc(def) + "</dd>" : "") + extraRows(j) +
        (j.prefecture || j.city ? "<dt>発生</dt><dd>" + esc([j.occurred_on, j.prefecture, j.city].filter(Boolean).join(" ")) + "</dd>" : "") +
        (j.police_agency ? "<dt>警察</dt><dd>" + esc(j.police_agency) + "</dd>" : "") +
        (j.prosecutor_office ? "<dt>検察</dt><dd>" + esc(j.prosecutor_office) + "</dd>" : "") +
        "<dt>控訴</dt><dd>" + esc(j.appeal_status || "不明") + "</dd>" +
        '<dt>出典</dt><dd><a href="' + esc(j.source_url) + '" target="_blank" rel="noopener noreferrer">' + esc(j.source_name || j.source_url) + "</a></dd></dl></div>";
    }).join("");
    const hidden = k.status === "hidden";
    $("#detailBody").innerHTML =
      '<div class="row"><button class="btn" data-close>閉じる</button><span style="flex:1"></span>' +
      '<button class="btn ' + (hidden ? "primary" : "danger") + '" id="toggleStatus">' + (hidden ? "公開に戻す" : "非公開にする") + "</button></div>" +
      '<div class="panel"><h2>' + esc(k.title) + "</h2>" +
      (hidden ? '<span class="tag danger">非公開</span>' : "") + (k.is_juvenile ? '<span class="tag">少年事件</span>' : "") + (k.flagged ? '<span class="tag warn">要確認</span>' : "") +
      '<div style="margin-top:6px">' + (k.themes || []).map((t) => '<span class="tag" title="' + (t.source === "auto" ? "データから自動で判定" : "Muse が記事から付けた") + '">#' + esc(t.theme) + (t.source === "auto" ? "" : " ✎") + "</span>").join("") + "</div>" +
      '<dl class="kv"><dt>case_ref</dt><dd>' + esc(k.case_ref) + "</dd><dt>最新の段階</dt><dd>" + esc(k.latest_stage) + (k.progress ? "（" + esc(k.progress) + "）" : "") + "</dd><dt>発生</dt><dd>" + esc([k.occurred_on, k.prefecture, k.city].filter(Boolean).join(" ")) + "</dd></dl></div>" +
      '<div class="panel"><h2>時系列</h2><div class="timeline">' + evHtml + "</div></div>";
    $("#detail").style.display = "block";
    $("#toggleStatus").onclick = async () => {
      await api("/api/v1/admin/cases/" + encodeURIComponent(k.id) + "/status", { method: "POST", body: JSON.stringify({ status: hidden ? "published" : "hidden" }) });
      await openCase(k.id);
      if (!$("#tab-cases").hidden) renderCases();
      if (!$("#tab-flagged").hidden) renderFlagged();
    };
  }

  // ===== 都道府県 =====
  const BASIS_LABEL = { occurrence: "発生地", police: "捜査した警察", court: "判決の裁判所" };
  let prefData = null;
  $("#prefFilter").addEventListener("submit", (e) => { e.preventDefault(); renderPrefs(); });
  $("#prefFilter").addEventListener("change", (e) => { if (e.target.name === "sort" || e.target.name === "hideZero") drawPrefs(); });
  async function renderPrefs() {
    const fd = new FormData($("#prefFilter"));
    const p = new URLSearchParams();
    for (const k of ["basis", "from", "to", "law"]) if (fd.get(k)) p.set(k, fd.get(k));
    prefData = await api("/api/v1/admin/prefecture-stats?" + p);
    drawPrefs();
  }
  function drawPrefs() {
    if (!prefData) return;
    const fd = new FormData($("#prefFilter"));
    let rows = prefData.prefectures.slice();
    if (fd.get("hideZero")) rows = rows.filter((r) => r.cases > 0);
    if (fd.get("sort") === "cases") rows.sort((a, b) => b.cases - a.cases);
    const max = Math.max(1, ...rows.map((r) => r.cases));
    const faint = (n, html) => (n < 5 ? '<span class="muted">' + html + "</span>" : html);
    const metric = (v, n, fmt) => (v == null ? '<span class="muted">–</span>' : faint(n, fmt(v) + ' <span class="muted">(n=' + n + ")</span>"));
    $("#prefTable").innerHTML = '<p><b>' + esc(BASIS_LABEL[prefData.basis]) + "</b> の都道府県で集計。事件 " + prefData.total_cases + " 件。</p>" +
      (rows.length === 0 ? '<p class="muted">該当する事件はありません。</p>' :
      '<div style="overflow-x:auto"><table><thead><tr><th>都道府県</th><th class="num">事件</th><th style="width:18%"></th><th class="num hide-sm">うち少年</th>' +
      '<th class="num">判決</th><th class="num hide-sm">執行猶予率</th><th class="num hide-sm">実刑の平均刑期</th><th class="num">求刑比の平均</th><th class="hide-sm">主な分類</th></tr></thead><tbody>' +
      rows.map((r) => '<tr class="click-pref" data-pref="' + esc(r.prefecture) + '" style="cursor:pointer"><td>' + esc(r.prefecture) + '</td><td class="num">' + r.cases +
        '</td><td><div class="bar"><i style="width:' + Math.round((r.cases / max) * 100) + '%"></i></div></td><td class="num hide-sm">' + (r.juvenile_cases || "") +
        '</td><td class="num">' + (r.judgments || "") + '</td><td class="num hide-sm">' + metric(r.suspended_rate, r.custodial_judgments, pct) +
        '</td><td class="num hide-sm">' + metric(r.avg_term_months_actual, r.custodial_judgments, (v) => months(Math.round(v))) +
        '</td><td class="num">' + metric(r.avg_ratio_to_demand, r.n_ratio_to_demand, pct) +
        '</td><td class="hide-sm">' + r.by_group.slice(0, 3).map((g) => '<span class="tag">' + esc(g.group_name) + " " + g.cases + "</span>").join("") + "</td></tr>").join("") +
      "</tbody></table></div>");
  }
  // 集計タブのテーマを押したら、そのテーマの事件一覧を開く
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-theme]"); if (!a) return;
    e.preventDefault();
    const f = $("#caseFilter");
    f.reset();
    f.querySelector("select[name=theme]").value = a.dataset.theme;
    f.querySelector("select[name=status]").value = "";
    document.querySelector('#tabs button[data-tab=cases]').click();
  });
  document.addEventListener("click", (e) => {
    const tr = e.target.closest("tr.click-pref"); if (!tr || !prefData) return;
    const f = $("#caseFilter");
    f.reset();
    f.querySelector("select[name=prefecture]").value = tr.dataset.pref;
    f.querySelector("input[name=pref_basis]").value = prefData.basis;
    if (prefData.law) f.querySelector("select[name=law]").value = prefData.law;
    f.querySelector("select[name=status]").value = "";
    document.querySelector('#tabs button[data-tab=cases]').click();
  });
  $("#prefCsv").addEventListener("click", async () => {
    if (!prefData) await renderPrefs();
    const head = ["都道府県", "事件", "うち少年", "判決", "実刑・執行猶予の判決", "執行猶予率", "実刑の平均刑期（月）", "求刑比の平均", "求刑比のn", "法定刑内の位置の平均", "法定刑内の位置のn", "男性", "女性", "分類別"];
    const cell = (v) => { const s = v == null ? "" : String(v); return /[",\\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [head.join(",")].concat(prefData.prefectures.map((r) => [r.prefecture, r.cases, r.juvenile_cases, r.judgments, r.custodial_judgments, r.suspended_rate, r.avg_term_months_actual, r.avg_ratio_to_demand, r.n_ratio_to_demand, r.avg_position_in_range, r.n_position_in_range, r.male, r.female, r.by_group.map((g) => g.group_name + ":" + g.cases).join(" ")].map(cell).join(",")));
    const blob = new Blob(["\\ufeff" + lines.join("\\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "crime-watch-prefectures-" + prefData.basis + ".csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  // ===== 国籍 =====
  let natData = null;
  $("#natFilter").addEventListener("submit", (e) => { e.preventDefault(); renderNats(); });
  async function renderNats() {
    const fd = new FormData($("#natFilter"));
    const p = new URLSearchParams();
    for (const k of ["from", "to", "law", "prefecture"]) if (fd.get(k)) p.set(k, fd.get(k));
    natData = await api("/api/v1/admin/nationality-stats?" + p);
    const d = natData;
    const max = Math.max(1, ...d.nationalities.map((r) => r.people));
    const faint = (n, html) => (n < 5 ? '<span class="muted">' + html + "</span>" : html);
    const metric = (v, n) => (v == null ? '<span class="muted">–</span>' : faint(n, pct(v) + ' <span class="muted">(n=' + n + ")</span>"));
    $("#natTable").innerHTML =
      '<div class="grid" style="margin-bottom:12px">' +
      [["人数（全体）", d.total_people], ["国籍の記載あり", d.stated_people], ["うち外国籍", d.foreign_people]]
        .map(([k, v]) => '<div class="stat"><div class="v">' + esc(v) + '</div><div class="k">' + k + "</div></div>").join("") + "</div>" +
      (d.nationalities.length === 0 ? '<p class="muted">該当するデータはありません。</p>' :
      '<div style="overflow-x:auto"><table><thead><tr><th>国籍</th><th class="num">人数</th><th style="width:14%"></th><th class="num">事件</th>' +
      '<th class="num hide-sm">来日外国人</th><th class="num hide-sm">定着居住者</th><th class="hide-sm">在留資格</th><th class="hide-sm">主な分類</th><th class="hide-sm">主な都道府県</th>' +
      '<th class="num">判決</th><th class="num hide-sm">執行猶予率</th><th class="num hide-sm">求刑比の平均</th></tr></thead><tbody>' +
      d.nationalities.map((r) => "<tr" + (r.stated ? "" : ' class="muted"') + "><td>" + esc(r.nationality) + (r.code ? ' <span class="muted">' + esc(r.code) + "</span>" : "") +
        '</td><td class="num">' + r.people + '</td><td><div class="bar"><i style="width:' + Math.round((r.people / max) * 100) + '%"></i></div></td><td class="num">' + r.cases +
        '</td><td class="num hide-sm">' + (r.stated && r.code !== "JP" ? r.residence.来日外国人 || "" : "") + '</td><td class="num hide-sm">' + (r.stated && r.code !== "JP" ? r.residence.定着居住者 || "" : "") +
        '</td><td class="hide-sm">' + r.residence.内訳.slice(0, 3).map((x) => '<span class="tag">' + esc(x.status) + " " + x.people + "</span>").join("") +
        '</td><td class="hide-sm">' + r.by_group.slice(0, 3).map((g) => '<span class="tag">' + esc(g.group_name) + " " + g.cases + "</span>").join("") +
        '</td><td class="hide-sm">' + r.top_prefectures.slice(0, 3).map((x) => esc(x.prefecture) + " " + x.people).join("、") +
        '</td><td class="num">' + (r.judgments || "") + '</td><td class="num hide-sm">' + metric(r.suspended_rate, r.custodial_judgments) +
        '</td><td class="num hide-sm">' + metric(r.avg_ratio_to_demand, r.n_ratio_to_demand) + "</td></tr>").join("") +
      "</tbody></table></div>");
  }
  $("#natCsv").addEventListener("click", async () => {
    if (!natData) await renderNats();
    const head = ["国籍", "コード", "人数", "事件", "来日外国人", "定着居住者", "在留資格不明", "在留資格の内訳", "分類別", "主な都道府県", "判決", "執行猶予率", "求刑比の平均", "求刑比のn"];
    const cell = (v) => { const s = v == null ? "" : String(v); return /[",\\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [head.join(",")].concat(natData.nationalities.map((r) => [r.nationality, r.code, r.people, r.cases, r.residence.来日外国人, r.residence.定着居住者, r.residence.不明,
      r.residence.内訳.map((x) => x.status + ":" + x.people).join(" "), r.by_group.map((g) => g.group_name + ":" + g.cases).join(" "),
      r.top_prefectures.map((x) => x.prefecture + ":" + x.people).join(" "), r.judgments, r.suspended_rate, r.avg_ratio_to_demand, r.n_ratio_to_demand].map(cell).join(",")));
    const blob = new Blob(["\\ufeff" + lines.join("\\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "crime-watch-nationalities.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  // ===== 要確認 =====
  let showReviewed = false;
  async function renderFlagged() {
    const r = await api("/api/v1/admin/flagged" + (showReviewed ? "?reviewed=true" : ""));
    if (!showReviewed) $("#flagCount").textContent = r.items.length;
    // UTC（…Z）の時刻は日本時間に直して表示する
    const fmt = (v) => {
      const t = String(v || "");
      if (/Z$/.test(t)) {
        const d = new Date(Date.parse(t) + 9 * 3600 * 1000).toISOString();
        return esc(d.slice(0, 16).replace("T", " "));
      }
      return esc(t.slice(0, 16).replace("T", " "));
    };
    $("#tab-flagged").innerHTML = '<div class="panel">' +
      '<div class="row"><button class="btn' + (showReviewed ? "" : " primary") + '" data-show="pending">未確認</button>' +
      '<button class="btn' + (showReviewed ? " primary" : "") + '" data-show="reviewed">確認済み</button></div>' +
      "<h2>" + (showReviewed ? "確認済みの報道・判決" : "自動チェックに引っかかった報道・判決") + "（" + r.items.length + " 件）</h2>" +
      '<p class="muted">' + (showReviewed
        ? "問題なしと確認したものです。送り直しなどで検出内容が変わると、未確認に戻ります。"
        : "印の付いた部分を確認してください。実名など公開できない情報があれば「事件を開く」から非公開にします。問題がなければ「確認済み」を押すと、この一覧から外れます。") + "</p>" +
      (r.items.length === 0 ? '<p class="muted">ありません。</p>' :
        r.items.map((it) => '<div class="panel"><div class="when muted">' + fmt(it.at) + " " + (it.type === "report" ? "報道" : "判決") + " " + esc(it.external_id) +
          (it.status === "hidden" ? ' <span class="tag danger">非公開</span>' : "") +
          (showReviewed && it.reviewed_at ? " ／ 確認：" + fmt(it.reviewed_at) : "") + "</div>" +
          "<div><b>" + highlight(it.title, it.flags) + "</b></div><div>" + highlight(it.summary, it.flags) + "</div>" + flagTags(it.flags) +
          (showReviewed && it.note ? '<div class="muted">メモ：' + esc(it.note) + "</div>" : "") +
          '<div class="row" style="margin:8px 0 0"><a href="#" data-case="' + esc(it.case_id) + '">事件を開く</a><span style="flex:1"></span>' +
          (showReviewed
            ? '<button class="btn" data-review="undo" data-type="' + esc(it.type) + '" data-id="' + esc(it.id) + '">確認を取り消す</button>'
            : '<input data-note-for="' + esc(it.id) + '" placeholder="メモ（任意）" size="20"><button class="btn primary" data-review="ok" data-type="' + esc(it.type) + '" data-id="' + esc(it.id) + '">確認済み（問題なし）</button>') +
          "</div></div>").join("")) + "</div>";
  }
  document.addEventListener("click", async (e) => {
    const sw = e.target.closest("#tab-flagged [data-show]");
    if (sw) { showReviewed = sw.dataset.show === "reviewed"; renderFlagged(); return; }
    const b = e.target.closest("#tab-flagged [data-review]");
    if (!b) return;
    b.disabled = true;
    const noteEl = document.querySelector('[data-note-for="' + CSS.escape(b.dataset.id) + '"]');
    try {
      await api("/api/v1/admin/flag-reviews", { method: "POST", body: JSON.stringify({ type: b.dataset.type, id: b.dataset.id, undo: b.dataset.review === "undo", note: noteEl && noteEl.value ? noteEl.value : undefined }) });
      await renderFlagged();
      refreshBadges();
    } catch (err) { msg(String(err.message || err), true); b.disabled = false; }
  });

  // ===== 未分類の罪状 =====
  async function renderUnclassified() {
    const s = await api("/api/v1/admin/trial-stats");
    const opts = '<option value="">法律を選ぶ</option>' + laws.map((l) => '<option value="' + esc(l.code) + '">' + esc(l.group_name) + "｜" + esc(l.name) + "</option>").join("");
    $("#uncCount").textContent = s.top_unclassified.length;
    $("#tab-unclassified").innerHTML = '<div class="panel"><h2>法律を判定できなかった罪状</h2>' +
      '<p class="muted">言い方を罪状辞書に追加すると、保存済みのデータも判定し直されます。罪状名ではない表記（「大けがをさせた」など）は、Muse に正しい罪名で送り直してもらってください。</p>' +
      (s.top_unclassified.length === 0 ? '<p class="muted">ありません。</p>' :
        '<table><thead><tr><th>罪状</th><th class="num">件数</th><th>辞書に追加</th></tr></thead><tbody>' +
        s.top_unclassified.map((u) => '<tr><td>' + esc(u.charge_text) + '</td><td class="num">' + esc(u.n) + '</td><td><form class="row aliasForm" style="margin:0" data-alias="' + esc(u.charge_text) + '"><select name="law">' + opts + '</select><button class="btn primary">追加</button></form></td></tr>').join("") +
        "</tbody></table>") + "</div>";
    document.querySelectorAll(".aliasForm").forEach((f) => f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const law = f.querySelector("select").value; if (!law) return;
      try {
        const r = await api("/api/v1/admin/aliases", { method: "POST", body: JSON.stringify({ alias: f.dataset.alias, law_code: law }) });
        msg("「" + f.dataset.alias + "」を " + lawName(law) + " として追加し、罪状 " + r.changed + " 件を判定し直しました。");
        renderUnclassified();
      } catch (err) { msg(String(err.message || err), true); }
    }));
  }

  if (token) { $("#token").value = token; init(); } else { msg("閲覧用トークン（VIEWER_TOKEN）を入力してください。"); }
})();
</script>
</body>
</html>`;
