import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import report from "../schema/examples/report.json";
import judgment from "../schema/examples/judgment.json";
import { signedIngest, view } from "./helpers";

type Json = Record<string, any>;

describe("死活確認", () => {
  it("テーブルと初期データがそろっていれば ready", async () => {
    const res = await SELF.fetch("https://cw.test/api/v1/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json;
    expect(body.database).toBe("ready");
    expect(body.laws).toBeGreaterThan(0);
  });
});

describe("DB の状態の確認", () => {
  it("後から追加した列がなければ migration_pending を返し、取り込みも断る", async () => {
    await env.DB.exec("ALTER TABLE report_persons DROP COLUMN plea");
    try {
      const h = await SELF.fetch("https://cw.test/api/v1/health");
      expect(h.status).toBe(503);
      const hb = (await h.json()) as Json;
      expect(hb.database).toBe("migration_pending");
      expect(hb.missing[0]).toContain("report_persons.plea");
      const res = await signedIngest(report);
      expect(res.status).toBe(503);
      expect(((await res.json()) as Json).error).toBe("database_migration_pending");
    } finally {
      await env.DB.exec("ALTER TABLE report_persons ADD COLUMN plea TEXT");
    }
  });
});

describe("受信 API の認証", () => {
  it("トークンが違えば 401", async () => {
    const res = await signedIngest(report, { token: "wrong" });
    expect(res.status).toBe(401);
  });
  it("署名が違えば 401", async () => {
    const res = await signedIngest(report, { secret: "wrong" });
    expect(res.status).toBe(401);
    expect(((await res.json()) as Json).reason).toBe("bad_signature");
  });
  it("時刻が大きくずれていれば 401（再送攻撃の防止）", async () => {
    const res = await signedIngest(report, { ts: Math.floor(Date.now() / 1000) - 3600 });
    expect(((await res.json()) as Json).reason).toBe("timestamp_out_of_range");
  });
  it("items が空なら 400", async () => {
    const res = await signedIngest({ items: [] });
    expect(res.status).toBe(400);
  });
});

describe("取り込み", () => {
  it("逮捕報道 → 判決の順に取り込み、事件にまとめ、指標を計算し、性別を引き継ぐ", async () => {
    const r1 = (await (await signedIngest(report)).json()) as Json;
    expect(r1.created).toBe(1);
    const r2 = (await (await signedIngest(judgment)).json()) as Json;
    expect(r2.created).toBe(1);
    expect(r2.results[0].status).toBe("created");

    const list = (await (await view("/api/v1/cases")).json()) as Json;
    const kase = list.cases.find((c: Json) => c.case_ref === "muse-case-000456");
    expect(kase.latest_stage).toBe("判決");
    expect(kase.prefecture).toBe("大阪府");
    expect(kase.occurred_on).toBe("2026-03-01");
    expect(kase.backfill).toBe(1);

    const detail = (await (await view(`/api/v1/cases/${kase.id}`)).json()) as Json;
    expect(detail.reports).toHaveLength(1);
    expect(detail.reports[0].charges[0].law_code).toBe("fraud");
    const j = detail.judgments[0];
    expect(j.court_name).toBe("大阪地方裁判所");
    expect(j.term_months).toBe(36);
    expect(j.suspended_months).toBe(60);
    expect(j.demand_months).toBe(48);
    expect(j.ratio_to_demand).toBe(0.75);
    // 詐欺（1か月〜10年）で 3年 → (36-1)/(120-1)
    expect(j.position_in_range).toBeCloseTo(35 / 119, 3);
    expect(j.primary_law_code).toBe("fraud");
    expect(j.defendant_gender).toBe("male");
    expect(j.gender_inherited).toBe(1);
    expect(j.defendant_age_group).toBe("20代");
    expect(j.judges[0].name).toBe("山田太郎");
    expect(j.judges[0].role).toBe("単独");
    expect(j).not.toHaveProperty("person_ref");
  });

  it("不同意性交等は行為時点の法定刑で計算し、被害者の情報を検出する", async () => {
    const item = {
      ...judgment.items[0],
      external_id: "sa-1",
      case_ref: "case-sa-1",
      charges: ["強制性交等"],
      occurred_on: "2020-05-01",
      sentence: { type: "懲役", term: "6年" },
      demand: { type: "懲役", term: "8年" },
      title: "強制性交等の罪で懲役6年",
      summary: "知人の女性（19）に対する強制性交等の罪で、懲役6年の判決。",
    };
    const res = (await (await signedIngest({ items: [item] })).json()) as Json;
    expect(res.created).toBe(1);
    expect(res.flagged).toBe(1);
    const row = await env.DB.prepare("SELECT primary_law_code, position_in_range, ratio_to_demand FROM judgments WHERE external_id = 'sa-1'").first<Json>();
    expect(row?.primary_law_code).toBe("sexual_assault");
    // 2020 年の行為なので強制性交等罪（5年以上）: (72-60)/(240-60)
    expect(row?.position_in_range).toBeCloseTo(12 / 180, 3);
    expect(row?.ratio_to_demand).toBe(0.75);
  });

  it("時系列: 一審判決 → 控訴の報道 → 控訴審判決 → 確定の報道 の順に最新の段階が変わる", async () => {
    const base = report.items[0] as Json;
    const { city: _c, suspects: _s, ...r } = base;
    const j1 = { ...judgment.items[0], external_id: "tl-j1", case_ref: "case-tl", instance: "一審", decided_on: "2026-03-01" };
    const appeal = { ...r, external_id: "tl-r-appeal", case_ref: "case-tl", stage: "控訴", reported_at: "2026-03-10T12:00:00+09:00" };
    const j2 = { ...judgment.items[0], external_id: "tl-j2", case_ref: "case-tl", instance: "控訴審", court: "大阪高裁", decided_on: "2026-08-01" };
    const fin = { ...r, external_id: "tl-r-final", case_ref: "case-tl", stage: "確定", reported_at: "2026-08-20T12:00:00+09:00" };
    const stage = async () => ((await (await view("/api/v1/cases/case-tl")).json()) as Json).case.latest_stage;
    await signedIngest({ items: [j1] });
    expect(await stage()).toBe("判決");
    await signedIngest({ items: [appeal] });
    expect(await stage()).toBe("控訴");
    await signedIngest({ items: [j2] });
    expect(await stage()).toBe("判決");
    await signedIngest({ items: [fin] });
    expect(await stage()).toBe("確定");
    const detail = (await (await view("/api/v1/cases/case-tl")).json()) as Json;
    expect(detail.judgments.map((j: Json) => j.instance)).toEqual(["一審", "控訴審"]);
    expect(detail.judgments[1].court_level).toBe("高裁");
  });

  it("報道の被疑者ごとの認否を保存する", async () => {
    const item = {
      ...report.items[0],
      external_id: "plea-1",
      case_ref: "case-plea-1",
      suspects: [{ person_ref: "p-plea", gender: "female", age: 41, plea: "deny" }],
    };
    const res = (await (await signedIngest({ items: [item] })).json()) as Json;
    expect(res.created).toBe(1);
    const row = await env.DB.prepare("SELECT plea FROM report_persons WHERE person_ref = 'p-plea'").first<{ plea: string }>();
    expect(row?.plea).toBe("deny");
  });

  it("同じ external_id の再送は更新として扱う（冪等）", async () => {
    await signedIngest(report);
    const again = (await (await signedIngest(report)).json()) as Json;
    expect(again.updated).toBe(1);
    expect(again.created).toBe(0);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM reports WHERE external_id = ?")
      .bind("muse-r-20260310-000123")
      .first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it("壊れた項目だけを rejected にし、他は取り込む", async () => {
    const bad = { ...report.items[0], external_id: "bad-1", prefecture: "大阪" };
    const good = { ...report.items[0], external_id: "good-1", case_ref: "case-good-1" };
    const res = (await (await signedIngest({ items: [bad, good] })).json()) as Json;
    expect(res.rejected).toBe(1);
    expect(res.created).toBe(1);
    expect(res.results[0].errors[0].path).toBe("prefecture");
  });

  it("少年事件でも市区町村・正確な年齢・警察署を受け付けて表示する（v0.17 の方針変更）", async () => {
    const juv = {
      ...report.items[0],
      external_id: "juv-1",
      case_ref: "case-juv-1",
      is_juvenile: true,
      police_station: "天満署",
      suspects: [{ person_ref: "pj", gender: "male", age: 17 }],
    };
    const res = (await (await signedIngest({ items: [juv] })).json()) as Json;
    expect(res.rejected).toBe(0);
    const detail = (await (await view("/api/v1/cases/case-juv-1")).json()) as Json;
    expect(detail.case.is_juvenile).toBe(1);
    expect(detail.case.city).toBe("大阪市");
    expect(detail.reports[0].police_station).toBe("天満署");
    expect(detail.reports[0].suspects[0]).toMatchObject({ age: 17, age_group: "10代", juvenile_class: "juvenile" });
  });

  it("少年事件の印は一度付いたら外さない", async () => {
    const juv = { ...report.items[0], external_id: "juv-2", case_ref: "case-juv-2", is_juvenile: true };
    await signedIngest({ items: [juv] });
    const later = { ...report.items[0], external_id: "juv-3", case_ref: "case-juv-2", stage: "起訴", reported_at: "2026-04-01T10:00:00+09:00" };
    await signedIngest({ items: [later] });
    const detail = (await (await view("/api/v1/cases/case-juv-2")).json()) as Json;
    expect(detail.case.is_juvenile).toBe(1);
  });

  it("人名らしき表記があっても公開は止めず、flags を記録する", async () => {
    const item = { ...report.items[0], external_id: "pii-1", case_ref: "case-pii-1", summary: "山田太郎容疑者が逮捕された。" };
    const res = (await (await signedIngest({ items: [item] })).json()) as Json;
    expect(res.created).toBe(1);
    expect(res.flagged).toBe(1);
    const detail = (await (await view("/api/v1/cases/case-pii-1")).json()) as Json;
    expect(detail.case.flagged).toBe(1);
  });

  it("未分類の罪状を結果で知らせる", async () => {
    const item = { ...report.items[0], external_id: "unc-1", case_ref: "case-unc-1", charges: ["種苗法違反"] };
    const res = (await (await signedIngest({ items: [item] })).json()) as Json;
    expect(res.results[0].unclassified_charges).toEqual(["種苗法"]);
  });

  it("受信ログと原本を D1 に保存する", async () => {
    const res = (await (await signedIngest(report)).json()) as Json;
    const log = await env.DB.prepare("SELECT item_count FROM ingest_logs WHERE id = ?").bind(res.ingest_id).first<{ item_count: number }>();
    expect(log?.item_count).toBe(1);
    const raw = await env.DB.prepare("SELECT body FROM raw_payloads WHERE ingest_id = ?").bind(res.ingest_id).first<{ body: string }>();
    expect(JSON.parse(raw!.body)).toEqual(report);
  });
});

describe("自動チェックの付け直し", () => {
  it("ルール変更前に付いた誤検出の flags を外す", async () => {
    const item = { ...judgment.items[0], external_id: "rs-1", case_ref: "case-rs-1", summary: "会社役員の被告に判決" };
    await signedIngest({ items: [item] });
    // 古いルールで付いた flags を再現する
    await env.DB.prepare("UPDATE judgments SET flags = ? WHERE external_id = 'rs-1'")
      .bind(JSON.stringify([{ kind: "person_name", field: "summary", match: "会社役員の被告" }]))
      .run();
    const res = await SELF.fetch("https://cw.test/api/v1/admin/rescan-flags", {
      method: "POST",
      headers: { Authorization: "Bearer test-viewer-token" },
    });
    const body = (await res.json()) as Json;
    expect(body.changed).toBeGreaterThanOrEqual(1);
    const row = await env.DB.prepare("SELECT flags FROM judgments WHERE external_id = 'rs-1'").first<Json>();
    expect(row?.flags).toBeNull();
    const kase = await env.DB.prepare("SELECT flagged FROM cases WHERE case_ref = 'case-rs-1'").first<Json>();
    expect(kase?.flagged).toBe(0);
  });
});

describe("場所・捜査機関の保存", () => {
  it("報道の県警・警察署・検察庁、判決の発生場所を保存し、事件の都道府県は発生場所を優先する", async () => {
    const r = { ...report.items[0], external_id: "ag-r", case_ref: "case-ag", police_agency: "大阪府警", police_station: "天満警察署", prosecutor_office: "大阪地検" };
    const j = { ...judgment.items[0], external_id: "ag-j", case_ref: "case-ag", prefecture: "兵庫県", city: "尼崎市", police_agency: "兵庫県警", prosecutor_office: "神戸地検" };
    await signedIngest({ items: [r, j] });
    const d = (await (await view("/api/v1/cases/case-ag")).json()) as Json;
    expect(d.reports[0].police_agency).toBe("大阪府警察");
    expect(d.reports[0].police_prefecture).toBe("大阪府");
    expect(d.reports[0].police_station).toBe("天満署");
    expect(d.reports[0].prosecutor_office).toBe("大阪地方検察庁");
    expect(d.judgments[0].prefecture).toBe("兵庫県");
    expect(d.judgments[0].city).toBe("尼崎市");
    expect(d.judgments[0].police_prefecture).toBe("兵庫県");
    expect(d.judgments[0].prosecutor_office).toBe("神戸地方検察庁");
  });

  it("報道がない判決だけの事件では、判決の発生場所を事件の都道府県にする（裁判所の所在地より優先）", async () => {
    const j = { ...judgment.items[0], external_id: "ag-j2", case_ref: "case-ag2", court: "大阪地裁", prefecture: "奈良県" };
    await signedIngest({ items: [j] });
    const d = (await (await view("/api/v1/cases/case-ag2")).json()) as Json;
    expect(d.case.prefecture).toBe("奈良県");
    const j3 = { ...judgment.items[0], external_id: "ag-j3", case_ref: "case-ag3", court: "大阪地裁" };
    await signedIngest({ items: [j3] });
    const d3 = (await (await view("/api/v1/cases/case-ag3")).json()) as Json;
    expect(d3.case.prefecture).toBe("大阪府");
  });

  it("少年事件の判決でも市区町村と年齢を保存する", async () => {
    const j = { ...judgment.items[0], external_id: "ag-juv-j", case_ref: "case-ag-juv", is_juvenile: true, city: "大阪市", defendant: { gender: "male", age: 19 } };
    const res = (await (await signedIngest({ items: [j] })).json()) as Json;
    expect(res.rejected).toBe(0);
    const d = (await (await view("/api/v1/cases/case-ag-juv")).json()) as Json;
    expect(d.judgments[0]).toMatchObject({ city: "大阪市", defendant_age: 19, juvenile_class: "specified_juvenile" });
  });
});

describe("事件の状況・被害者・職業", () => {
  it("状況の分類、被害者の粗い属性、職業の区分を保存して返す", async () => {
    const r = {
      ...report.items[0],
      external_id: "cx-r",
      case_ref: "case-cx",
      suspects: [{ person_ref: "p-cx", gender: "male", age: 52, occupation: "無職" }],
      victims: [{ gender: "female", age_group: "70代", relation: "面識なし" }],
      circumstances: { motive: "金銭", weapon: "なし", accomplice_count: 2, location_type: "住宅" },
    };
    const j = {
      ...judgment.items[0],
      external_id: "cx-j",
      case_ref: "case-cx",
      defendant: { person_ref: "p-cx", gender: "male", age: 52, occupation: "無職" },
      victims: [{ gender: "female", age_group: "70代", relation: "面識なし" }],
      circumstances: { motive: "金銭", accomplice_count: 2 },
    };
    const res = (await (await signedIngest({ items: [r, j] })).json()) as Json;
    expect(res.rejected).toBe(0);
    const d = (await (await view("/api/v1/cases/case-cx")).json()) as Json;
    expect(d.reports[0].motive).toBe("金銭");
    expect(d.reports[0].accomplice_count).toBe(2);
    expect(d.reports[0].location_type).toBe("住宅");
    expect(d.reports[0].suspects[0].occupation).toBe("無職");
    expect(d.reports[0].victims).toEqual([{ gender: "female", age_group: "70代", occupation: null, relation: "面識なし" }]);
    expect(d.judgments[0].defendant_occupation).toBe("無職");
    expect(d.judgments[0].victims[0].relation).toBe("面識なし");
  });

  it("被害者の正確な年齢や氏名は受け付けない", async () => {
    const r = { ...report.items[0], external_id: "cx-bad", case_ref: "case-cx-bad", victims: [{ age: 72, name: "x" }] };
    const res = (await (await signedIngest({ items: [r] })).json()) as Json;
    expect(res.rejected).toBe(1);
  });
});

describe("管理 API と管理画面", () => {
  const post = (path: string, body: unknown) =>
    SELF.fetch(`https://cw.test${path}`, {
      method: "POST",
      headers: { Authorization: "Bearer test-viewer-token", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("事件を非公開にすると一覧から消え、status=all では見える", async () => {
    const r = { ...report.items[0], external_id: "adm-1", case_ref: "case-adm-1" };
    await signedIngest({ items: [r] });
    expect((await post("/api/v1/admin/cases/case-adm-1/status", { status: "hidden" })).status).toBe(200);
    const pub = (await (await view("/api/v1/cases?limit=200")).json()) as Json;
    expect(pub.cases.some((c: Json) => c.case_ref === "case-adm-1")).toBe(false);
    const all = (await (await view("/api/v1/cases?limit=200&status=all")).json()) as Json;
    expect(all.cases.find((c: Json) => c.case_ref === "case-adm-1").status).toBe("hidden");
    await post("/api/v1/admin/cases/case-adm-1/status", { status: "published" });
  });

  it("罪状辞書に言い方を追加すると、保存済みの罪状と判決の量刑指標が計算し直される", async () => {
    const j = { ...judgment.items[0], external_id: "adm-j", case_ref: "case-adm-j", charges: ["受け子詐欺"] };
    // 「受け子詐欺」は「詐欺」を含むので判定される。辞書にない罪状で試す
    const j2 = { ...j, external_id: "adm-j2", case_ref: "case-adm-j2", charges: ["給付金だまし取り"] };
    await signedIngest({ items: [j2] });
    let row = await env.DB.prepare("SELECT primary_law_code, position_in_range FROM judgments WHERE external_id = 'adm-j2'").first<Json>();
    expect(row?.primary_law_code).toBeNull();
    const res = await post("/api/v1/admin/aliases", { alias: "給付金だまし取り", law_code: "fraud" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json;
    expect(body.changed).toBeGreaterThanOrEqual(1);
    row = await env.DB.prepare("SELECT primary_law_code, position_in_range FROM judgments WHERE external_id = 'adm-j2'").first<Json>();
    expect(row?.primary_law_code).toBe("fraud");
    expect(row?.position_in_range).toBeCloseTo(35 / 119, 3);
  });

  it("存在しない法律コードは追加できない", async () => {
    expect((await post("/api/v1/admin/aliases", { alias: "なにか", law_code: "nope" })).status).toBe(400);
  });

  it("要確認の一覧を返す", async () => {
    const r = { ...report.items[0], external_id: "adm-f", case_ref: "case-adm-f", summary: "山田太郎容疑者を逮捕" };
    await signedIngest({ items: [r] });
    const f = (await (await view("/api/v1/admin/flagged")).json()) as Json;
    expect(f.items.find((x: Json) => x.external_id === "adm-f").flags[0].kind).toBe("person_name");
  });

  it("管理画面はトークンなしで開けるが、データは含まない", async () => {
    const res = await SELF.fetch("https://cw.test/admin");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
    const html = await res.text();
    expect(html).toContain("HANZAI Watch 管理");
    expect(html).not.toContain("muse-r-");
  });
});

describe("要確認の確認済み", () => {
  const post = (path: string, body: unknown) =>
    SELF.fetch(`https://cw.test${path}`, {
      method: "POST",
      headers: { Authorization: "Bearer test-viewer-token", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const pending = async () => ((await (await view("/api/v1/admin/flagged")).json()) as Json).items as Json[];
  const reviewed = async () => ((await (await view("/api/v1/admin/flagged?reviewed=true")).json()) as Json).items as Json[];
  const caseFlag = async () => (await env.DB.prepare("SELECT flagged FROM cases WHERE case_ref = 'case-rv'").first<Json>())?.flagged;

  it("確認済みにすると一覧と事件の印から外れ、自動チェックをやり直しても残り、内容が変わると戻る", async () => {
    const item = { ...report.items[0], external_id: "rv-1", case_ref: "case-rv", summary: "山田太郎容疑者を逮捕" };
    await signedIngest({ items: [item] });
    const it = (await pending()).find((x) => x.external_id === "rv-1")!;
    expect(it).toBeTruthy();
    expect(await caseFlag()).toBe(1);

    expect((await post("/api/v1/admin/flag-reviews", { type: "report", id: it.id, note: "同名の別人ではなく誤検出" })).status).toBe(200);
    expect((await pending()).some((x) => x.external_id === "rv-1")).toBe(false);
    const rv = (await reviewed()).find((x) => x.external_id === "rv-1")!;
    expect(rv.note).toBe("同名の別人ではなく誤検出");
    expect(await caseFlag()).toBe(0);

    // 自動チェックをやり直しても、検出内容が同じなら確認済みのまま
    await post("/api/v1/admin/rescan-flags", {});
    expect((await pending()).some((x) => x.external_id === "rv-1")).toBe(false);

    // 送り直しで検出内容が変わったら、未確認に戻る
    await signedIngest({ items: [{ ...item, summary: "佐藤花子容疑者を逮捕" }] });
    expect((await pending()).some((x) => x.external_id === "rv-1")).toBe(true);
    expect(await caseFlag()).toBe(1);

    // 確認と取り消し
    await post("/api/v1/admin/flag-reviews", { type: "report", id: it.id });
    expect(await caseFlag()).toBe(0);
    await post("/api/v1/admin/flag-reviews", { type: "report", id: it.id, undo: true });
    expect((await pending()).some((x) => x.external_id === "rv-1")).toBe(true);
    expect(await caseFlag()).toBe(1);
  });

  it("不正な指定は断る", async () => {
    expect((await post("/api/v1/admin/flag-reviews", { type: "x", id: "y" })).status).toBe(400);
    expect((await post("/api/v1/admin/flag-reviews", { type: "report", id: "nope" })).status).toBe(404);
  });
});

describe("事件の進み具合", () => {
  const prog = async (ref: string) => ((await (await view("/api/v1/cases/" + ref)).json()) as Json).case.progress;
  const base = () => {
    const { city: _c, suspects: _s, ...r } = report.items[0] as Json;
    return r;
  };
  it("逮捕→起訴→判決→確定で進み具合が変わる", async () => {
    await signedIngest({ items: [{ ...base(), external_id: "pg-1", case_ref: "case-pg", stage: "逮捕", reported_at: "2026-05-01T10:00:00+09:00" }] });
    expect(await prog("case-pg")).toBe("捜査中");
    await signedIngest({ items: [{ ...base(), external_id: "pg-2", case_ref: "case-pg", stage: "起訴", reported_at: "2026-05-20T10:00:00+09:00" }] });
    expect(await prog("case-pg")).toBe("公判中");
    await signedIngest({ items: [{ ...judgment.items[0], external_id: "pg-3", case_ref: "case-pg", decided_on: "2026-09-01" }] });
    expect(await prog("case-pg")).toBe("判決後（未確定）");
    await signedIngest({ items: [{ ...base(), external_id: "pg-4", case_ref: "case-pg", stage: "確定", reported_at: "2026-09-20T10:00:00+09:00" }] });
    expect(await prog("case-pg")).toBe("確定");
  });
  it("不起訴で終わる事件と理由", async () => {
    await signedIngest({ items: [{ ...base(), external_id: "pg-5", case_ref: "case-pg2", stage: "逮捕", reported_at: "2026-05-01T10:00:00+09:00" }] });
    await signedIngest({
      items: [{ ...base(), external_id: "pg-6", case_ref: "case-pg2", stage: "不起訴", non_prosecution_reason: "不明", reported_at: "2026-05-22T10:00:00+09:00" }],
    });
    const d = (await (await view("/api/v1/cases/case-pg2")).json()) as Json;
    expect(d.case.progress).toBe("不起訴");
    expect(d.reports.find((r: Json) => r.external_id === "pg-6").non_prosecution_reason).toBe("不明");
    const list = (await (await view("/api/v1/cases?progress=" + encodeURIComponent("不起訴") + "&limit=200")).json()) as Json;
    expect(list.cases.some((c: Json) => c.case_ref === "case-pg2")).toBe(true);
  });
  it("略式命令は略式手続", async () => {
    await signedIngest({
      items: [{ ...judgment.items[0], external_id: "pg-7", case_ref: "case-pg3", court: "東京簡裁", instance: "略式命令", sentence: { type: "罰金", fine_yen: 300000 } }],
    });
    expect(await prog("case-pg3")).toBe("略式手続");
  });
});

describe("テーマ", () => {
  const themesOf = async (ref: string) =>
    (((await (await view("/api/v1/cases/" + ref)).json()) as Json).case.themes as Json[]).map((t) => `${t.theme}:${t.source}`).sort();

  it("Muse が付けたテーマと、データから自動で判定したテーマを事件にまとめる", async () => {
    const r = {
      ...report.items[0],
      external_id: "th-r",
      case_ref: "case-th",
      charges: ["特殊詐欺"],
      themes: ["闇バイト・トクリュウ"],
      suspects: [{ person_ref: "th1", gender: "male", age: 29, occupation: "公務員", nationality: "ベトナム国籍" }],
      victims: [{ gender: "female", age_group: "80代" }],
    };
    const j = { ...judgment.items[0], external_id: "th-j", case_ref: "case-th", charges: ["詐欺"], sentence: { type: "拘禁刑", term: "5年" }, demand: { type: "拘禁刑", term: "4年" } };
    expect(((await (await signedIngest({ items: [r, j] })).json()) as Json).rejected).toBe(0);
    expect(await themesOf("case-th")).toEqual(
      ["公務員の犯罪:auto", "外国人犯罪:auto", "求刑超え:auto", "特殊詐欺:auto", "闇バイト・トクリュウ:muse", "高齢者が被害者:auto"].sort(),
    );
    const list = (await (await view("/api/v1/cases?theme=" + encodeURIComponent("求刑超え") + "&limit=200")).json()) as Json;
    const row = list.cases.find((c: Json) => c.case_ref === "case-th");
    expect(row.themes).toContain("闇バイト・トクリュウ");
  });

  it("著名人は区分だけを保存してテーマにし、交通の罪の 75 歳以上は高齢ドライバー", async () => {
    const r = {
      ...report.items[0],
      external_id: "th-r2",
      case_ref: "case-th2",
      charges: ["過失運転致傷", "酒気帯び運転"],
      suspects: [{ person_ref: "th2", gender: "male", age: 78, public_figure: "歌舞伎役者" }],
    };
    await signedIngest({ items: [r] });
    expect(await themesOf("case-th2")).toEqual(["著名人:auto", "飲酒運転:auto", "高齢ドライバー:auto"].sort());
    const d = (await (await view("/api/v1/cases/case-th2")).json()) as Json;
    expect(d.reports[0].suspects[0].public_figure).toBe("歌舞伎役者");
  });

  it("一覧にないテーマや著名人の区分は受け付けない", async () => {
    const r = { ...report.items[0], external_id: "th-bad", case_ref: "case-th-bad", themes: ["炎上"] };
    expect(((await (await signedIngest({ items: [r] })).json()) as Json).rejected).toBe(1);
  });

  it("全事件のテーマを付け直せる", async () => {
    await env.DB.exec("DELETE FROM case_themes");
    const res = await SELF.fetch("https://cw.test/api/v1/admin/recompute-themes", { method: "POST", headers: { Authorization: "Bearer test-viewer-token" } });
    expect(((await res.json()) as Json).themes).toBeGreaterThan(0);
    expect(await themesOf("case-th")).toContain("闇バイト・トクリュウ:muse");
  });
});

describe("国籍", () => {
  it("報道の国籍・在留資格を保存し、判決に引き継ぎ、国籍別に人数で集計する（記載なしは日本国籍とみなさない）", async () => {
    const r = {
      ...report.items[0],
      external_id: "nat-r",
      case_ref: "case-nat",
      occurred_on: "2026-07-07",
      suspects: [
        { person_ref: "n1", gender: "male", age: 26, nationality: "ベトナム国籍", residence_status: "技能実習" },
        { person_ref: "n2", gender: "male", age: 31 },
      ],
    };
    const j1 = { ...judgment.items[0], external_id: "nat-j1", case_ref: "case-nat", defendant: { person_ref: "n1", gender: "unknown" } };
    const j2 = { ...judgment.items[0], external_id: "nat-j2", case_ref: "case-nat", defendant: { person_ref: "n2", gender: "unknown" } };
    const res = (await (await signedIngest({ items: [r, j1, j2] })).json()) as Json;
    expect(res.rejected).toBe(0);
    const d = (await (await view("/api/v1/cases/case-nat")).json()) as Json;
    expect(d.reports[0].suspects[0]).toMatchObject({ nationality: "ベトナム", nationality_code: "VN", residence_status: "技能実習" });
    const jd = d.judgments.find((x: Json) => x.external_id === "nat-j1");
    expect(jd).toMatchObject({ defendant_nationality: "ベトナム", defendant_residence_status: "技能実習", nationality_inherited: 1 });
    expect(d.judgments.find((x: Json) => x.external_id === "nat-j2").defendant_nationality).toBeNull();

    const st = (await (await view("/api/v1/admin/nationality-stats?from=2026-07-07&to=2026-07-07")).json()) as Json;
    expect(st.total_people).toBe(2);
    expect(st.stated_people).toBe(1);
    expect(st.foreign_people).toBe(1);
    const vn = st.nationalities.find((x: Json) => x.nationality === "ベトナム");
    expect(vn).toMatchObject({ code: "VN", people: 1, cases: 1, judgments: 1 });
    expect(vn.residence.来日外国人).toBe(1);
    expect(st.nationalities.find((x: Json) => x.nationality === "記載なし").people).toBe(1);
    // 記載なしは最後に並ぶ
    expect(st.nationalities[st.nationalities.length - 1].nationality).toBe("記載なし");
  });
});

describe("都道府県別の集計", () => {
  it("発生地・警察・裁判所の基準で数え、判決の指標を出す", async () => {
    // 発生は奈良県、捜査は大阪府警、判決は大阪地裁
    const r = { ...report.items[0], external_id: "pf-r", case_ref: "case-pf", prefecture: "奈良県", city: "奈良市", police_agency: "大阪府警", occurred_on: "2026-02-01" };
    const j = { ...judgment.items[0], external_id: "pf-j", case_ref: "case-pf", court: "大阪地裁", prefecture: "奈良県" };
    await signedIngest({ items: [r, j] });
    const get = async (qs: string) => (await (await view("/api/v1/admin/prefecture-stats?" + qs)).json()) as Json;
    const pick = (d: Json, pref: string) => d.prefectures.find((p: Json) => p.prefecture === pref);

    const occ = await get("basis=occurrence&from=2026-02-01&to=2026-02-01");
    expect(occ.prefectures).toHaveLength(48);
    expect(pick(occ, "奈良県").cases).toBe(1);
    expect(pick(occ, "奈良県").judgments).toBe(1);
    expect(pick(occ, "奈良県").suspended_rate).toBe(1);
    expect(pick(occ, "奈良県").avg_ratio_to_demand).toBe(0.75);
    expect(pick(occ, "奈良県").by_group[0]).toEqual({ category: "刑法犯", group_name: "知能犯", cases: 1 });
    expect(pick(occ, "大阪府").cases).toBe(0);

    const pol = await get("basis=police&from=2026-02-01&to=2026-02-01");
    expect(pick(pol, "大阪府").cases).toBe(1);
    expect(pick(pol, "奈良県").cases).toBe(0);

    const court = await get("basis=court&from=2026-02-01&to=2026-02-01&law=fraud");
    expect(pick(court, "大阪府").cases).toBe(1);
    const none = await get("basis=court&from=2026-02-01&to=2026-02-01&law=murder");
    expect(none.total_cases).toBe(0);

    // 事件一覧も同じ基準で絞り込める
    const list = (await (await view("/api/v1/cases?prefecture=" + encodeURIComponent("大阪府") + "&pref_basis=police&limit=200")).json()) as Json;
    expect(list.cases.some((c: Json) => c.case_ref === "case-pf")).toBe(true);
  });
});

describe("閲覧 API（非公開）", () => {
  it("トークンなしでは見られない", async () => {
    const res = await SELF.fetch("https://cw.test/api/v1/cases");
    expect(res.status).toBe(401);
  });
  it("試行の集計を返す", async () => {
    await signedIngest(report);
    await signedIngest(judgment);
    const stats = (await (await view("/api/v1/admin/trial-stats")).json()) as Json;
    expect(stats.totals.judgments).toBeGreaterThanOrEqual(1);
    expect(stats.judgment_fill_rates.demand).toBe(1);
    expect(stats.by_law.find((r: Json) => r.code === "fraud").judgments).toBeGreaterThanOrEqual(1);
  });
});

describe("受け付けなかった項目の一覧", () => {
  it("原本から理由を出し、送り直して取り込まれたものは除く", async () => {
    const bad = { ...report.items[0], external_id: "rej-1", case_ref: "case-rej-1", stage: "存在しない段階" };
    await signedIngest({ items: [bad] });
    const list = async () =>
      (await (await view("/api/v1/admin/rejections")).json()) as {
        rejections: { external_id: string; errors: { path: string }[] }[];
      };
    const first = await list();
    const hit = first.rejections.find((r) => r.external_id === "rej-1");
    expect(hit?.errors.map((e) => e.path)).toContain("stage");
    await signedIngest({ items: [{ ...bad, stage: "逮捕" }] });
    expect((await list()).rejections.find((r) => r.external_id === "rej-1")).toBeUndefined();
  });
});

describe("罪状の判定し直し", () => {
  it("前の罪状に頼る「行使」も、元の文字列ごとに判定し直す", async () => {
    const item = { ...report.items[0], external_id: "rc-1", case_ref: "case-rc-1", charges: ["詐欺", "虚偽公文書作成・行使"] };
    await signedIngest({ items: [item] });
    const r = await env.DB.prepare("SELECT id FROM reports WHERE external_id = 'rc-1'").first<{ id: string }>();
    // 「行使」の規則がなかった頃の保存状態を再現する
    await env.DB.prepare("UPDATE report_charges SET charge_text = '行使', law_code = NULL, matched_alias = NULL WHERE report_id = ? AND seq = 2")
      .bind(r!.id)
      .run();
    const res = await SELF.fetch("https://cw.test/api/v1/admin/reclassify", { method: "POST", headers: { Authorization: "Bearer test-viewer-token" } });
    expect(res.status).toBe(200);
    const { results } = await env.DB.prepare("SELECT seq, charge_text, law_code FROM report_charges WHERE report_id = ? ORDER BY seq")
      .bind(r!.id)
      .all<{ seq: number; charge_text: string; law_code: string | null }>();
    expect(results.map((x) => x.law_code)).toEqual(["fraud", "forgery", "forgery"]);
    expect(results[2]?.charge_text).toBe("虚偽公文書作成・行使");
  });
});
