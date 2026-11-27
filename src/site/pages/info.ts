// 静的・案内ページ（/about, /about/metrics, /contact）
import type { Context } from "hono";
import { html } from "hono/html";
import type { Env } from "../../env";
import { nowIso } from "../../normalize";
import { renderLayout } from "../layout";
import { POPULATION_SOURCE_LABEL, POPULATION_SOURCE_URL } from "../population";

/** /about */
export function renderAboutPage(c: Context<{ Bindings: Env }>) {
  const origin = new URL(c.req.url).origin;
  const body = html`
    <section class="card">
      <h1 class="page-h1">このサイトについて</h1>
      <p class="page-lead">
        Crime Watch は、日本国内で報道された犯罪および判決（量刑・裁判所・担当裁判官）で明らかになった<strong>事実だけ</strong>を記録し、法律・テーマごとに整理して公開するデータアーカイブです。
      </p>

      <h2 class="card-title mt-16">基本方針：事実のみを記載する</h2>
      <ul style="padding-left:20px;color:var(--text-sub);margin:0 0 16px">
        <li><strong>出典のある事実だけを記録する</strong>：すべての報道・判決に出典 URL を付し、記事本文の転載は行いません。</li>
        <li><strong>推測で埋めない</strong>：記事に書かれていない項目（国籍、審級、未報道の段階など）は空のまま「記載なし」とします。</li>
        <li><strong>評価・解釈を加えない</strong>：「甘い」「厳しい」「多い」などの評価語、ランキング、良し悪しを表す色分けは行いません。</li>
        <li><strong>推定無罪の明記</strong>：有罪が確定していない事件には「有罪が確定したものではありません」と表示します。</li>
      </ul>

      <h2 class="card-title mt-16">データの収集と AI の誤りについて</h2>
      <p style="color:var(--text-sub);margin:0 0 16px">
        データは AI が公開されているニュース報道などから自動で構造化し、本アプリが罪状から法律を自動分類して公開しています。
        自動処理の性質上、誤りや最新の続報とのずれを含む場合があります。必ず各ページの出典記事をご確認ください。
      </p>

      <h2 class="card-title mt-16">個人情報・著名人・少年事件の扱い</h2>
      <ul style="padding-left:20px;color:var(--text-sub);margin:0 0 16px">
        <li>被告人・被疑者・被害者・証人の氏名、顔写真、番地までの住所、学校名、勤務先は扱いません。</li>
        <li>著名人が関わる事件でも本名・芸名は掲載せず、「某歌手」「某俳優」などの職業区分のみで記録します。</li>
        <li>少年事件も対象に含め、氏名等を除いた事実（年齢・地域・罪状等）を記録します。被害者の年齢は年代までとします。</li>
        <li>前科の有無は個別の事件ページには表示せず、集計にのみ用います。</li>
      </ul>

      <h2 class="card-title mt-16">削除・訂正の依頼</h2>
      <p style="color:var(--text-sub);margin:0">
        内容の誤りや削除のご依頼は、<a href="/contact">削除・訂正の依頼フォーム</a>よりご連絡ください。管理者が内容を確認のうえ、速やかに訂正または非公開化などの対応を行います。
      </p>
    </section>
  `;

  return c.html(
    renderLayout({
      title: "このサイトについて｜Crime Watch",
      description: "Crime Watch の基本方針、データの集め方、AI の誤りへの備え、削除・訂正依頼の方法。",
      canonicalPath: "/about",
      origin,
      body,
    }),
  );
}

/** /about/metrics */
export function renderAboutMetricsPage(c: Context<{ Bindings: Env }>) {
  const origin = new URL(c.req.url).origin;
  const body = html`
    <section class="card">
      <h1 class="page-h1">この数字について（量刑指標の定義と限界）</h1>
      <p class="page-lead">
        Crime Watch で表示する量刑バー・統計指標の計算式と、数値を読み取るうえでの前提・限界を公開します。
      </p>

      <h2 class="card-title mt-16">判決 1 件ごとの指標</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>指標</th>
              <th>計算式</th>
              <th>意味</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>A. 法定刑内の位置</strong></td>
              <td class="small">(判決刑期 − 法定刑下限) ÷ (法定刑上限 − 法定刑下限)</td>
              <td class="small">行為時点で有効な法定刑の幅の中で、判決刑期がどこに位置するか（0%＝下限、100%＝上限）。加重・減軽により範囲を超える場合があります。</td>
            </tr>
            <tr>
              <td><strong>B. 求刑比</strong></td>
              <td class="small">判決刑期 ÷ 求刑刑期</td>
              <td class="small">検察の求刑に対する判決刑期の割合（例: 求刑4年→判決3年は 75%）。</td>
            </tr>
            <tr>
              <td><strong>C. 同種判決との分布</strong></td>
              <td class="small">同じ主たる罪名・審級の成人有期刑の 25%・中央値・75%</td>
              <td class="small">同じ罪名の判決全体の中でどのあたりに位置するかを示します。</td>
            </tr>
            <tr>
              <td><strong>D. 執行猶予率</strong></td>
              <td class="small">執行猶予付き件数 ÷ 成人有期刑件数</td>
              <td class="small">有期拘禁刑・懲役・禁錮のうち執行猶予が付いた割合。</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 class="card-title mt-16">数字を読むうえでの前提と限界</h2>
      <ul style="padding-left:20px;color:var(--text-sub);margin:0">
        <li><strong>報道による偏り</strong>：元データは「報道された事件・判決」に限られ、全国の全事件・全判決ではありません。重大事件や社会的関心の高い事件に偏ります。</li>
        <li><strong>件数の下限と 95% 信頼区間</strong>：件数が 20 件未満の区分では平均値や分布帯を表示しません。平均値には必ず件数と 95% 信頼区間を添えます。</li>
        <li><strong>未補正の事情</strong>：前科・示談・犯行の計画性などの量刑事情は報道から網羅的に取得できないため、これらを補正した比較は行っていません。</li>
        <li><strong>人口 10 万人あたり件数</strong>：<a href="${POPULATION_SOURCE_URL}" target="_blank" rel="noopener noreferrer">${POPULATION_SOURCE_LABEL}</a>を分母として算出しています。</li>
      </ul>
    </section>
  `;

  return c.html(
    renderLayout({
      title: "この数字について｜Crime Watch",
      description: "量刑バー・求刑比・法定刑内の位置・執行猶予率の計算式と、報道データの限界について。",
      canonicalPath: "/about/metrics",
      origin,
      body,
    }),
  );
}

interface ContactViewState {
  kind?: string;
  targetUrl?: string;
  bodyText?: string;
  contact?: string;
  error?: string;
  submittedId?: string;
}

function renderContactView(c: Context<{ Bindings: Env }>, state: ContactViewState, status: 200 | 400 = 200) {
  const origin = new URL(c.req.url).origin;
  const siteKey = c.env.TURNSTILE_SITE_KEY;
  const kind = state.kind ?? "correction";

  const body = html`
    <section class="card" style="max-width:680px;margin:0 auto">
      <h1 class="page-h1">削除・訂正の依頼</h1>
      <p class="page-lead">
        記載内容の誤りや削除のご依頼を受け付けています。送信内容は管理者が確認のうえ、訂正・非公開化などを判断・対応します。
      </p>

      ${state.submittedId
        ? html`<div class="note-box" style="margin-bottom:16px;color:var(--text)">
            <strong>ご依頼を受け付けました。</strong>（受付番号: <span class="num">${state.submittedId.slice(0, 8)}</span>）<br />
            内容を確認のうえ対応いたします。
          </div>`
        : ""}
      ${state.error
        ? html`<div class="note-box" style="margin-bottom:16px;color:var(--text)">${state.error}</div>`
        : ""}

      <form method="post" action="/contact" style="display:flex;flex-direction:column;gap:14px">
        <!-- スパム対策用ハニーポット -->
        <div style="position:absolute;left:-9999px" aria-hidden="true">
          <label>Website <input type="text" name="website" tabindex="-1" autocomplete="off" /></label>
        </div>

        <fieldset style="border:0;padding:0;margin:0">
          <legend class="small" style="font-weight:700;margin-bottom:6px">依頼の種類</legend>
          <div class="pills">
            <label class="pill" style="cursor:pointer">
              <input type="radio" name="kind" value="correction" ${kind === "correction" ? "checked" : ""} /> 内容の誤り・訂正
            </label>
            <label class="pill" style="cursor:pointer">
              <input type="radio" name="kind" value="removal" ${kind === "removal" ? "checked" : ""} /> 削除・非公開の依頼
            </label>
            <label class="pill" style="cursor:pointer">
              <input type="radio" name="kind" value="other" ${kind === "other" ? "checked" : ""} /> その他
            </label>
          </div>
        </fieldset>

        <div>
          <label for="target_url" class="small" style="display:block;font-weight:700;margin-bottom:6px">対象の事件 URL（任意）</label>
          <input
            id="target_url"
            class="input"
            type="text"
            name="target_url"
            value="${state.targetUrl ?? ""}"
            placeholder="https://.../cases/..."
            style="width:100%"
          />
        </div>

        <div>
          <label for="body" class="small" style="display:block;font-weight:700;margin-bottom:6px">内容（必須）</label>
          <textarea
            id="body"
            class="input"
            name="body"
            rows="6"
            required
            placeholder="誤りの箇所や正しい情報（出典 URL があれば併記）、または削除を求める理由をご記入ください。"
            style="width:100%;resize:vertical"
          >${state.bodyText ?? ""}</textarea>
        </div>

        <div>
          <label for="contact" class="small" style="display:block;font-weight:700;margin-bottom:6px">連絡先メールアドレス（任意）</label>
          <input
            id="contact"
            class="input"
            type="email"
            name="contact"
            value="${state.contact ?? ""}"
            placeholder="reply@example.com"
            style="width:100%"
          />
        </div>

        ${siteKey
          ? html`
              <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
              <div class="cf-turnstile" data-sitekey="${siteKey}"></div>
            `
          : ""}

        <div>
          <button class="btn btn-primary" type="submit">依頼を送信する</button>
        </div>
      </form>
    </section>
  `;

  return c.html(
    renderLayout({
      title: "削除・訂正の依頼｜Crime Watch",
      description: "Crime Watch に掲載された事件・判決データの訂正や削除を依頼できます。",
      canonicalPath: "/contact",
      origin,
      body,
    }),
    status,
  );
}

/** GET /contact */
export function renderContactPage(c: Context<{ Bindings: Env }>) {
  const origin = new URL(c.req.url).origin;
  const caseParam = c.req.query("case");
  const targetUrl = caseParam ? `${origin}/cases/${encodeURIComponent(caseParam)}` : "";
  return renderContactView(c, { targetUrl });
}

function extractCaseId(targetUrl: string): string | null {
  const m = targetUrl.match(/\/cases\/([^/?#]+)/);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

/** POST /contact */
export async function handleContactSubmit(c: Context<{ Bindings: Env }>) {
  const form = await c.req.parseBody();
  const honeypot = typeof form.website === "string" ? form.website.trim() : "";
  const kindRaw = typeof form.kind === "string" ? form.kind : "correction";
  const kind = kindRaw === "removal" || kindRaw === "other" ? kindRaw : "correction";
  const targetUrl = typeof form.target_url === "string" ? form.target_url.trim().slice(0, 500) : "";
  const bodyText = typeof form.body === "string" ? form.body.trim() : "";
  const contact = typeof form.contact === "string" ? form.contact.trim().slice(0, 200) : "";

  // ハニーポットに値が入っていればスパムとして静かに完了扱い（保存しない）
  if (honeypot) {
    return renderContactView(c, { submittedId: "00000000" });
  }

  if (bodyText.length < 5 || bodyText.length > 5000) {
    return renderContactView(
      c,
      { kind, targetUrl, bodyText, contact, error: "内容は 5 文字以上 5,000 文字以内で入力してください。" },
      400,
    );
  }

  // Turnstile が設定されている場合のみ検証する
  if (c.env.TURNSTILE_SITE_KEY && c.env.TURNSTILE_SECRET_KEY) {
    const token = typeof form["cf-turnstile-response"] === "string" ? form["cf-turnstile-response"] : "";
    if (!token) {
      return renderContactView(
        c,
        { kind, targetUrl, bodyText, contact, error: "認証チェックを完了してから送信してください。" },
        400,
      );
    }
    const verifyRes = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: c.env.TURNSTILE_SECRET_KEY, response: token }),
    });
    const verifyJson = (await verifyRes.json().catch(() => ({}))) as { success?: boolean };
    if (!verifyJson.success) {
      return renderContactView(
        c,
        { kind, targetUrl, bodyText, contact, error: "認証チェックに失敗しました。再度お試しください。" },
        400,
      );
    }
  }

  const id = crypto.randomUUID();
  const now = nowIso();
  const caseId = targetUrl ? extractCaseId(targetUrl) : null;

  // 削除依頼でも自動非公開にはせず、requests テーブルに保存して管理者の確認を待つ（合意済み仕様 S-1）
  await c.env.DB.prepare(
    `INSERT INTO requests (id, kind, case_id, target_url, body, contact, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
  )
    .bind(id, kind, caseId, targetUrl || null, bodyText, contact || null, now, now)
    .run();

  return renderContactView(c, { submittedId: id });
}
