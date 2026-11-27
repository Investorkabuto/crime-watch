import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { signedIngest, view } from "./helpers";

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
    const hideRes = await SELF.fetch(`https://cw.test/api/v1/admin/cases/${hiddenCaseId}/status`, {
      method: "POST",
      headers: { Authorization: "Bearer test-viewer-token", "Content-Type": "application/json" },
      body: JSON.stringify({ status: "hidden" }),
    });
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
    expect(homeHtml).toContain("Crime Watch");
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
    expect(await lawsRes.text()).toContain("強盗致傷");

    const lawDetail = await view("/laws/robbery_injury");
    expect(lawDetail.status).toBe(200);
    expect(await lawDetail.text()).toContain("件数 20 件未満のため非表示");

    const prefsRes = await view("/prefectures");
    expect(prefsRes.status).toBe(200);
    const prefsHtml = await prefsRes.text();
    expect(prefsHtml).toContain("人口10万人あたり");
    expect(prefsHtml).toContain("総務省統計局");

    const prefDetail = await view(`/prefectures/${encodeURIComponent("東京都")}`);
    expect(prefDetail.status).toBe(200);
    expect(await prefDetail.text()).toContain("東京都の事件・判決");

    const statsRes = await view("/stats");
    expect(statsRes.status).toBe(200);
    expect(await statsRes.text()).toContain("都道府県 × 法律の件数");

    const csvRes = await view("/stats/export.csv");
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers.get("Content-Type")).toContain("text/csv");
    expect(await csvRes.text()).toContain("prefecture,law_code,law_name,cases,cases_per_100k");
  });

  it("/about・/about/metrics・/contact が動作し、削除依頼でも事件は自動非公開にならない", async () => {
    expect((await view("/about")).status).toBe(200);
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
    const aggRes = await SELF.fetch("https://cw.test/api/v1/admin/recompute-aggregates", {
      method: "POST",
      headers: { Authorization: "Bearer test-viewer-token" },
    });
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
});
