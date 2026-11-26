import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import report from "../schema/examples/report.json";
import judgment from "../schema/examples/judgment.json";
import { signedIngest, view } from "./helpers";

type Json = Record<string, any>;

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

  it("少年事件では市区町村・正確な年齢を受け付けない", async () => {
    const juv = { ...report.items[0], external_id: "juv-1", case_ref: "case-juv-1", is_juvenile: true };
    const res = (await (await signedIngest({ items: [juv] })).json()) as Json;
    expect(res.rejected).toBe(1);
    const paths = res.results[0].errors.map((e: Json) => e.path);
    expect(paths).toContain("city");
    expect(paths).toContain("suspects.0.age");
  });

  it("少年事件の判決は、後から is_juvenile を付け忘れても市区町村を出さない", async () => {
    const { city: _c, suspects: _s, ...base } = report.items[0] as Json;
    const juv = { ...base, external_id: "juv-2", case_ref: "case-juv-2", is_juvenile: true, suspects: [{ juvenile_class: "juvenile", gender: "male" }] };
    await signedIngest({ items: [juv] });
    const later = { ...report.items[0], external_id: "juv-3", case_ref: "case-juv-2", stage: "起訴", reported_at: "2026-04-01T10:00:00+09:00" };
    await signedIngest({ items: [later] });
    const detail = (await (await view("/api/v1/cases/case-juv-2")).json()) as Json;
    expect(detail.case.is_juvenile).toBe(1);
    expect(detail.case.city).toBeNull();
    expect(detail.reports.every((r: Json) => r.city === null)).toBe(true);
    expect(detail.reports.flatMap((r: Json) => r.suspects).every((p: Json) => p.age === null)).toBe(true);
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
    const item = { ...report.items[0], external_id: "unc-1", case_ref: "case-unc-1", charges: ["組織犯罪処罰法違反"] };
    const res = (await (await signedIngest({ items: [item] })).json()) as Json;
    expect(res.results[0].unclassified_charges).toEqual(["組織犯罪処罰法"]);
  });

  it("受信ログと原本を D1 に保存する", async () => {
    const res = (await (await signedIngest(report)).json()) as Json;
    const log = await env.DB.prepare("SELECT item_count FROM ingest_logs WHERE id = ?").bind(res.ingest_id).first<{ item_count: number }>();
    expect(log?.item_count).toBe(1);
    const raw = await env.DB.prepare("SELECT body FROM raw_payloads WHERE ingest_id = ?").bind(res.ingest_id).first<{ body: string }>();
    expect(JSON.parse(raw!.body)).toEqual(report);
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
