import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { LAW_TEXTS } from "../src/site/law-texts";
import { adminPost, signedIngest, view } from "./helpers";

describe("公開サイト（S1 + S2）", () => {
  let caseId = "";
  let hiddenCaseId = "";

  beforeAll(async () => {
    // テスト用の事件（報道 → 判決）を投入
    const r1 = await signedIngest({
      items: [
        {
          type: "report",
          external_id: "site-test-r-1",
          case_ref: "site-test-case-1",
          stage: "逮捕",
          title: "住宅に押し入り現金を奪った強盗致傷事件",
          summary: "住宅に押し入り現金を奪ったとして20代の男が逮捕された。",
          charges: ["強盗致傷"],
          is_juvenile: false,
          occurred_on: "2026-03-12",
          reported_at: "2026-04-02T10:00:00+09:00",
          prefecture: "東京都",
          city: "江東区",
          police_agency: "警視庁",
          police_station: "深川署",
          themes: ["闇バイト・トクリュウ"],
          suspects: [
            {
              person_ref: "p-site-1",
              gender: "male",
              age: 24,
              occupation: "無職",
              plea: "admit",
            },
          ],
          victims: [{ gender: "female", age_group: "70代", relation: "面識なし" }],
          source_url: "https://example.com/news/site-1",
          source_name: "テスト新聞",
        },
        {
          type: "judgment",
          external_id: "site-test-j-1",
          case_ref: "site-test-case-1",
          court: "東京地方裁判所",
          instance: "一審",
          decided_on: "2026-10-02",
          reported_at: "2026-10-02T18:00:00+09:00",
          occurred_on: "2026-03-12",
          prefecture: "東京都",
          judges: [{ name: "裁判 太郎", role: "裁判長" }],
          lay_judge_trial: true,
          charges: ["強盗致傷"],
          sentence: { type: "拘禁刑", term: "9年" },
          demand: { type: "拘禁刑", term: "12年" },
          defendant: {
            person_ref: "p-site-1",
            gender: "unknown",
            age: 24,
            juvenile_class: "adult",
            occupation: "無職",
          },
          factors: {
            prior_record: "yes",
            plea: "admit",
            settlement: "no",
            damage_yen: 3000000,
            victim_count: 1,
            harm_result: "minor",
          },
          title: "強盗致傷事件で被告に拘禁刑9年の判決",
          summary: "東京地裁は被告に拘禁刑9年（求刑12年）の判決を言い渡した。",
          is_juvenile: false,
          source_url: "https://example.com/news/site-2",
          source_name: "テスト新聞",
        },
        {
          type: "report",
          external_id: "site-test-r-hidden",
          case_ref: "site-test-case-hidden",
          stage: "逮捕",
          title: "非公開テスト用の事件",
          summary: "非公開化の確認用データ。",
          charges: ["窃盗"],
          is_juvenile: false,
          occurred_on: "2026-05-01",
          reported_at: "2026-05-02T09:00:00+09:00",
          prefecture: "大阪府",
          source_url: "https://example.com/news/site-hidden",
          source_name: "テスト新聞",
        },
      ],
    });
    expect(r1.status).toBe(200);
    const r1Body = (await r1.json()) as { rejected: number };
    expect(r1Body.rejected).toBe(0);

    const c1 = await env.DB.prepare("SELECT id FROM cases WHERE case_ref = ?").bind("site-test-case-1").first<{ id: string }>();
    const c2 = await env.DB.prepare("SELECT id FROM cases WHERE case_ref = ?").bind("site-test-case-hidden").first<{ id: string }>();
    caseId = c1!.id;
    hiddenCaseId = c2!.id;

    // 2件目を非公開に設定
    const hideRes = await adminPost(`/api/v1/admin/cases/${hiddenCaseId}/status`, { status: "hidden" });
    expect(hideRes.status).toBe(200);
  });

  it("非公開期間中は未認証でログイン画面(401)を返し、Cookie ログインで閲覧できる", async () => {
    const unauth = await SELF.fetch("https://cw.test/", { headers: { Accept: "text/html" } });
    expect(unauth.status).toBe(401);
    const loginHtml = await unauth.text();
    expect(loginHtml).toContain("閲覧用トークン");

    const robots = await SELF.fetch("https://cw.test/robots.txt");
    expect(robots.status).toBe(200);
    expect(await robots.text()).toContain("Disallow: /");

    const loginRes = await SELF.fetch("https://cw.test/_auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "token=test-viewer-token&next=%2F",
      redirect: "manual",
    });
    expect(loginRes.status).toBe(303);
    const setCookie = loginRes.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("cw_viewer=");
    expect(setCookie).toContain("HttpOnly");

    const cookiePair = setCookie.split(";")[0]!;
    const authed = await SELF.fetch("https://cw.test/", { headers: { Cookie: cookiePair } });
    expect(authed.status).toBe(200);
    const homeHtml = await authed.text();
    expect(homeHtml).toContain("HANZAI Watch");
    expect(homeHtml).toContain("最近動きのあった事件");
    expect(homeHtml).toContain("強盗致傷事件で被告に拘禁刑9年の判決");
  });

  it("事件詳細ページで進み具合・推定無罪・量刑バー・認否/示談を表示し、前科は表示しない", async () => {
    const res = await view(`/cases/${caseId}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("強盗致傷事件で被告に拘禁刑9年の判決");
    expect(html).toContain("有罪が確定したものではありません");
    expect(html).toContain("<svg");
    expect(html).toContain("拘禁刑 9年");
    expect(html).toContain("求刑 12年");
    expect(html).toContain("裁判長: 裁判太郎");
    // 認否・示談は報道準拠で表示
    expect(html).toContain("認めている");
    expect(html).toContain("不成立");
    // 前科は事件ページに出さない（合意済み S-2）
    expect(html).not.toContain("前科あり");
    expect(html).not.toContain("前科の有無");
  });

  it("非公開になった事件は 410 Gone を返す", async () => {
    const res = await view(`/cases/${hiddenCaseId}`);
    expect(res.status).toBe(410);
    expect(await res.text()).toContain("この事件は非公開になりました");
  });

  it("事件一覧・テーマ・法律・都道府県（人口10万人あたり）・統計・CSV が正常に返る", async () => {
    const casesRes = await view("/cases?q=%E5%BC%B7%E7%9B%97");
    expect(casesRes.status).toBe(200);
    expect(await casesRes.text()).toContain("強盗致傷事件で被告に拘禁刑9年の判決");

    const themesRes = await view("/themes");
    expect(themesRes.status).toBe(200);
    expect(await themesRes.text()).toContain("闇バイト・トクリュウ");

    const themeDetail = await view(`/themes/${encodeURIComponent("闇バイト・トクリュウ")}`);
    expect(themeDetail.status).toBe(200);
    expect(await themeDetail.text()).toContain("闇バイト・トクリュウ");

    const lawsRes = await view("/laws");
    expect(lawsRes.status).toBe(200);
    const lawsHtml = await lawsRes.text();
    expect(lawsHtml).toContain("強盗致傷");
    expect(lawsHtml).toContain("data-law-tab=");

    const lawDetail = await view("/laws/robbery_injury");
    expect(lawDetail.status).toBe(200);
    const lawDetailHtml = await lawDetail.text();
    expect(lawDetailHtml).toContain("件数 20 件未満のため非表示");
    expect(lawDetailHtml).toContain("わかりやすい要約");
    expect(lawDetailHtml).toContain("刑法 第240条前段");

    const prefsRes = await view("/prefectures");
    expect(prefsRes.status).toBe(200);
    const prefsHtml = await prefsRes.text();
    expect(prefsHtml).toContain("人口10万人あたり");
    expect(prefsHtml).not.toContain("捜査警察ベース");

    const prefDetail = await view(`/prefectures/${encodeURIComponent("東京都")}`);
    expect(prefDetail.status).toBe(200);
    const prefDetailText = await prefDetail.text();
    expect(prefDetailText).toContain("東京都の事件・判決");
    expect(prefDetailText).not.toContain("捜査警察ベース");

    const statsRes = await view("/stats");
    expect(statsRes.status).toBe(200);
    expect(await statsRes.text()).toContain("都道府県 × 法律の件数");

    const csvRes = await view("/stats/export.csv");
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers.get("Content-Type")).toContain("text/csv");
    expect(await csvRes.text()).toContain("prefecture,law_code,law_name,cases,cases_per_100k");
  });

  it("/about・/about/metrics・/contact が動作し、削除依頼でも事件は自動非公開にならない", async () => {
    const aboutRes = await view("/about");
    expect(aboutRes.status).toBe(200);
    const aboutHtml = await aboutRes.text();
    expect(aboutHtml).toContain("総務省統計局");
    expect((await view("/about/metrics")).status).toBe(200);
    expect((await view(`/contact?case=${caseId}`)).status).toBe(200);

    const postRes = await SELF.fetch("https://cw.test/contact", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-viewer-token",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        kind: "removal",
        target_url: `https://cw.test/cases/${caseId}`,
        body: "テスト用の削除依頼です。管理者確認後に判断されるべきです。",
        contact: "test@example.com",
      }).toString(),
    });
    expect(postRes.status).toBe(200);
    expect(await postRes.text()).toContain("ご依頼を受け付けました");

    // requests テーブルに保存され、かつ対象事件は published のまま
    const reqRow = await env.DB.prepare("SELECT kind, case_id, status FROM requests WHERE case_id = ?")
      .bind(caseId)
      .first<{ kind: string; case_id: string; status: string }>();
    expect(reqRow).toEqual({ kind: "removal", case_id: caseId, status: "open" });

    const caseAfter = await env.DB.prepare("SELECT status FROM cases WHERE id = ?").bind(caseId).first<{ status: string }>();
    expect(caseAfter?.status).toBe("published");
  });

  it("RSS・sitemap・OGP SVG・集計テーブル再計算が正常に動く", async () => {
    const aggRes = await adminPost("/api/v1/admin/recompute-aggregates");
    expect(aggRes.status).toBe(200);
    const aggJson = (await aggRes.json()) as { theme_rows: number; law_rows: number; dist_rows: number };
    expect(aggJson.theme_rows).toBeGreaterThan(0);
    expect(aggJson.law_rows).toBeGreaterThan(0);
    expect(aggJson.dist_rows).toBeGreaterThan(0);

    const feedRes = await view("/feed.xml");
    expect(feedRes.status).toBe(200);
    expect(await feedRes.text()).toContain("<rss version=\"2.0\">");

    const caseFeed = await view(`/cases/${caseId}/feed.xml`);
    expect(caseFeed.status).toBe(200);
    expect(await caseFeed.text()).toContain("拘禁刑 9年");

    const sitemapRes = await view("/sitemap.xml");
    expect(sitemapRes.status).toBe(200);
    const sm = await sitemapRes.text();
    expect(sm).toContain(`/cases/${caseId}`);
    expect(sm).not.toContain(`/cases/${hiddenCaseId}`);

    const ogRes = await view("/og/default.svg");
    expect(ogRes.status).toBe(200);
    expect(ogRes.headers.get("Content-Type")).toContain("image/svg+xml");
  });

  it("テーマ重複修正・Muse削除・HANZAI Watch改名・グラフ・日本地図・統一検索窓・ヘッダー簡素化が反映されている", async () => {
    // 同じ事件・同じテーマに auto と muse の両方が存在する状態を作る（強盗は自動付与される）
    await env.DB.prepare("INSERT OR IGNORE INTO case_themes (case_id, theme, source) VALUES (?, '強盗', 'muse')")
      .bind(caseId)
      .run();

    const themeHtml = await (await view(`/themes/${encodeURIComponent("強盗")}`)).text();
    const matches = themeHtml.match(/強盗致傷事件で被告に拘禁刑9年の判決/g) ?? [];
    expect(matches.length).toBe(1);

    const themeRss = await (await view(`/themes/${encodeURIComponent("強盗")}/feed.xml`)).text();
    const rssMatches = themeRss.match(/強盗致傷事件で被告に拘禁刑9年の判決/g) ?? [];
    expect(rssMatches.length).toBe(1);

    // 公開サイトに Muse の記名がないこと
    const themesListHtml = await (await view("/themes")).text();
    const aboutHtml = await (await view("/about")).text();
    expect(themesListHtml).not.toMatch(/muse/i);
    expect(themesListHtml).toContain("compact-grid");
    expect(aboutHtml).not.toMatch(/muse/i);

    // TOP: HANZAI Watch・最上部グラフ・外国人犯罪タイル・犯罪別/統計・バー付きテーマ・ダブルタップズーム防止
    const homeHtml = await (await view("/")).text();
    expect(homeHtml).toContain("HANZAI Watch");
    expect(homeHtml).toContain("touch-action: manipulation");
    expect(homeHtml).not.toContain("累計事件数");
    expect(homeHtml).not.toContain("法律の分類（上位）");
    expect(homeHtml).toContain("犯罪別");
    expect(homeHtml).not.toContain("統計・CSV");
    expect(homeHtml).toContain("bar-grid");
    expect(homeHtml).toContain("直近 1 年の犯罪・判決件数推移");
    expect(homeHtml.indexOf("直近 1 年の犯罪・判決件数推移")).toBeLessThan(homeHtml.indexOf("今週の報道"));
    expect(homeHtml).toContain("都道府県マップ");
    expect(homeHtml).toContain("外国人犯罪");
    expect(homeHtml).toContain(`/themes/${encodeURIComponent("外国人犯罪")}`);
    expect(homeHtml).toContain("求刑の 75%");
    expect(homeHtml).toContain("pill-stage-judgment");
    expect(homeHtml).toContain("続報 2");
    expect(homeHtml).toContain('id="cw-search-drawer"');
    expect(homeHtml).not.toContain('class="ai-notice"');
    expect(homeHtml).not.toContain('aria-label="メインナビゲーション"');
    expect(homeHtml).not.toContain('href="/about/metrics"');

    // DB の全法律に LAW_TEXTS（要約＋条文）が漏れなく定義されていること
    const allDbLaws = await env.DB.prepare("SELECT code FROM laws").all<{ code: string }>();
    const missingLawTexts = allDbLaws.results.map((r) => r.code).filter((c) => !(c in LAW_TEXTS));
    expect(missingLawTexts).toEqual([]);

    // 法律詳細ページに折りたたみ条文と法定刑の範囲内の量刑分布グラフが表示されること
    const lawDetailHtml = await (await view("/laws/robbery_injury")).text();
    expect(lawDetailHtml).toContain('class="article-details"');
    expect(lawDetailHtml).toContain("条文全文を見る");
    expect(lawDetailHtml).toContain("量刑の分布（法定刑の範囲内");
    expect(lawDetailHtml).toContain("法定刑の範囲内における量刑分布グラフ");

    // 都道府県ページにリアル日本地図 SVG と地域ズーム・地図外ドック・テーブル併用があること
    const prefsHtml = await (await view("/prefectures")).text();
    expect(prefsHtml).toContain('id="cw-japan-svg"');
    expect(prefsHtml).toContain('id="cw-map-dock"');
    expect(prefsHtml).not.toContain('id="cw-map-popover"');
    expect(prefsHtml).toContain("九州・沖縄");
    expect(prefsHtml).toContain('id="cw-pref-tbody"');

    // 都道府県詳細ページの法律・テーマ・市区町村リンクが都道府県で絞り込んだ /cases に飛ぶこと
    const prefDetailHtml = await (await view(`/prefectures/${encodeURIComponent("東京都")}`)).text();
    expect(prefDetailHtml).toContain(`/cases?prefecture=${encodeURIComponent("東京都")}&law=robbery_injury`);
    expect(prefDetailHtml).toContain(`/cases?prefecture=${encodeURIComponent("東京都")}&theme=${encodeURIComponent("闇バイト・トクリュウ")}`);
    expect(prefDetailHtml).toContain(`/cases?prefecture=${encodeURIComponent("東京都")}&city=${encodeURIComponent("江東区")}`);

    const cityCasesHtml = await (await view(`/cases?prefecture=${encodeURIComponent("東京都")}&city=${encodeURIComponent("江東区")}`)).text();
    expect(cityCasesHtml).toContain("強盗致傷事件で被告に拘禁刑9年の判決");

    // 統計ページ: 4タブ切替・戻る時タブ保持・性別×年代クロス表リンク・職業バーカード・国籍グラフ（記載あり/なしチップ削除）
    const statsHtml = await (await view("/stats")).text();
    expect(statsHtml).toContain('id="cw-search-drawer"');
    expect(statsHtml).not.toContain('class="filter-bar-btn"');
    expect(statsHtml).toContain('data-stats-tab="demo"');
    expect(statsHtml).toContain('data-stats-tab="occ"');
    expect(statsHtml).toContain('data-stats-tab="nat"');
    expect(statsHtml).toContain('data-stats-tab="cross"');
    expect(statsHtml).toContain("cw_stats_tab");
    expect(statsHtml).not.toContain("国籍別の人数（記載あり）");
    expect(statsHtml).toContain("ratio-bar");
    expect(statsHtml).toContain(`/cases?age_group=${encodeURIComponent("20代")}&amp;gender=male`);
    expect(statsHtml).toContain(`/cases?occupation=${encodeURIComponent("無職")}`);

    // /cases の性別・年代・職業フィルタが動作すること
    const attrCasesHtml = await (await view(`/cases?gender=male&age_group=${encodeURIComponent("20代")}&occupation=${encodeURIComponent("無職")}`)).text();
    expect(attrCasesHtml).toContain("強盗致傷事件で被告に拘禁刑9年の判決");
    expect(attrCasesHtml).toContain("性別: 男性");
    expect(attrCasesHtml).toContain("年代: 20代");
    expect(attrCasesHtml).toContain("職業: 無職");

    // 事件一覧で重複するページ内検索ボタンがなく、統一検索ドロワーが使われていること
    const casesHtml = await (await view("/cases")).text();
    expect(casesHtml).toContain('id="cw-search-drawer"');
    expect(casesHtml).not.toContain('class="filter-bar-btn"');
  });

  it("不正な % エンコードや想定外パラメータで 500 にならず安全に応答する", async () => {
    expect((await view("/themes/%ZZ")).status).toBe(404);
    expect((await view("/prefectures/%ZZ")).status).toBe(404);
    expect((await view("/themes/%ZZ/feed.xml")).status).toBe(404);
    expect((await view("/og/theme/%ZZ.svg")).status).toBe(200);
    expect((await view(`/cases?prefecture=${encodeURIComponent("東京都")}&pref_basis=constructor`)).status).toBe(200);

    // 不正な Cookie 値でも 500 にならない
    const badCookie = await SELF.fetch("https://cw.test/", {
      headers: { Accept: "text/html", Cookie: "cw_viewer=%ZZ" },
    });
    expect(badCookie.status).toBe(401);

    // 問い合わせフォームの target_url に不正な % が含まれても 500 にならない
    const contactRes = await SELF.fetch("https://cw.test/contact", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-viewer-token",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        kind: "correction",
        target_url: "https://cw.test/cases/%ZZ",
        body: "不正なエンコードを含む URL のテスト送信です。",
      }).toString(),
    });
    expect(contactRes.status).toBe(200);
  });

  it("セキュリティヘッダー、ヘッダーナビゲーション、有効なフォント指定、ADMIN_TOKEN ログインが機能する", async () => {
    // ADMIN_TOKEN でも非公開プレビューにログインできる
    const adminLogin = await SELF.fetch("https://cw.test/_auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "token=test-admin-token&next=%2Flaws",
      redirect: "manual",
    });
    expect(adminLogin.status).toBe(303);
    const cookie = (adminLogin.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

    const lawsRes = await SELF.fetch("https://cw.test/laws", { headers: { Cookie: cookie } });
    expect(lawsRes.status).toBe(200);

    // セキュリティヘッダー
    expect(lawsRes.headers.get("x-content-type-options")).toBe("nosniff");
    expect(lawsRes.headers.get("x-frame-options")).toBe("DENY");
    expect(lawsRes.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(lawsRes.headers.get("strict-transport-security")).toContain("max-age=");
    expect(lawsRes.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");

    const lawsHtml = await lawsRes.text();
    // ヘッダーナビゲーションが表示され、現在ページが active
    expect(lawsHtml).toContain('<nav class="nav"');
    expect(lawsHtml).toContain('<a href="/cases">事件一覧</a>');
    expect(lawsHtml).toContain('<a href="/laws" class="active" aria-current="page">法律</a>');
    expect(lawsHtml).toContain('<a href="/stats">統計</a>');

    // 無効な CSS ショートハンド `font: <size>/<lh> inherit` が含まれないこと
    expect(lawsHtml).not.toMatch(/font:\s*[^;]+inherit\s*;/);
  });
});
