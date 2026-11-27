import { describe, expect, it } from "vitest";
import { courtPrefecture, normalizeCourtName, courtLevel } from "../src/courts";
import { positionInRange, ratioToDemand, periodAt, type PenaltyPeriod } from "../src/metrics";
import { formatMonths, parseTermMonths } from "../src/normalize";
import { detectPii } from "../src/pii";
import { verifySignature, hmacSha256Hex } from "../src/auth";

describe("刑期の換算", () => {
  it.each([
    ["3年", 36],
    ["2年6月", 30],
    ["10月", 10],
    ["1年6か月", 18],
    ["８月", 8],
  ])("%s → %d か月", (t, m) => expect(parseTermMonths(t)).toBe(m));
  it("解釈できない値は null", () => expect(parseTermMonths("三年")).toBeNull());
  it("表示用に戻す", () => expect(formatMonths(30)).toBe("2年6月"));
});

describe("裁判所", () => {
  it("略称を正式名にする", () => expect(normalizeCourtName("東京地裁立川支部")).toBe("東京地方裁判所立川支部"));
  it("種類と都道府県", () => {
    expect(courtLevel("大阪高等裁判所")).toBe("高裁");
    expect(courtPrefecture("名古屋地方裁判所")).toBe("愛知県");
    expect(courtPrefecture("和歌山地方裁判所")).toBe("和歌山県");
    expect(courtPrefecture("東京高等裁判所")).toBeNull();
  });
});

describe("量刑指標", () => {
  const periods: PenaltyPeriod[] = [
    { law_code: "theft", effective_from: "1900-01-01", effective_to: null, stat_min_months: 1, stat_max_months: 120, stat_has_death: 0, stat_has_life: 0 },
    { law_code: "cannabis", effective_from: "1900-01-01", effective_to: "2024-12-12", stat_min_months: 1, stat_max_months: 60, stat_has_death: 0, stat_has_life: 0 },
    { law_code: "cannabis", effective_from: "2024-12-12", effective_to: null, stat_min_months: 1, stat_max_months: 84, stat_has_death: 0, stat_has_life: 0 },
  ];
  it("法定刑内の位置（窃盗 2年6月 ≒ 24%）", () => {
    expect(positionInRange("拘禁刑", 30, periodAt(periods, "theft", "2026-01-01"))).toBeCloseTo(0.2437, 3);
  });
  it("行為時点の法定刑を使う", () => {
    expect(periodAt(periods, "cannabis", "2024-12-11")?.stat_max_months).toBe(60);
    expect(periodAt(periods, "cannabis", "2024-12-12")?.stat_max_months).toBe(84);
  });
  it("罰金刑では計算しない", () => expect(positionInRange("罰金", null, periods[0]!)).toBeNull());
  it("求刑比", () => {
    expect(ratioToDemand("拘禁刑", 36, "拘禁刑", 48)).toBe(0.75);
    expect(ratioToDemand("拘禁刑", 36, "懲役", 48)).toBe(0.75);
    expect(ratioToDemand("拘禁刑", 36, "無期拘禁刑", null)).toBeNull();
  });
});

describe("自動チェック", () => {
  it("人名らしき表記・電話番号・番地を検出する", () => {
    const f = detectPii({ summary: "山田太郎容疑者（34）を逮捕。連絡先は03-1234-5678、住所は1丁目2番3号" }, false);
    expect(f.map((x) => x.kind).sort()).toEqual(["person_name", "phone", "street_address"]);
  });
  it.each([
    "和歌山地裁は被告に発作の認識があったと認定した",
    "殺人罪に問われた被告について",
    "会社役員の被告に懲役3年10月",
    "那覇地裁の裁判員裁判は被告の殺意を認定",
    "起訴された被告は否認",
  ])("人名ではない表記を検出しない: %s", (summary) => {
    expect(detectPii({ summary }, false)).toEqual([]);
  });
  it.each(["山田太郎被告に判決", "山田 太郎被告", "山田あやの被告", "佐藤容疑者を逮捕"])("人名は検出する: %s", (summary) => {
    expect(detectPii({ summary }, false).map((f) => f.kind)).toContain("person_name");
  });
  it("属性の表記は人名として扱わない", () => {
    expect(detectPii({ summary: "無職の男容疑者と会社員の女性被告" }, false)).toEqual([]);
  });
  it("少年事件では学校名を検出し、年齢は検出しない（v0.17 で年齢は公開する方針に変更）", () => {
    const kinds = detectPii({ summary: "市内の○○中学校に通う少年（15）" }, true).map((x) => x.kind);
    expect(kinds).toEqual(["school"]);
  });
});

describe("署名", () => {
  it("正しい署名を受け付け、時刻のずれや改ざんを拒否する", async () => {
    const body = '{"items":[]}';
    const sig = "sha256=" + (await hmacSha256Hex("k", `1000.${body}`));
    expect(await verifySignature({ secret: "k", timestamp: "1000", signature: sig, body, toleranceSec: 300, nowSec: 1100 })).toEqual({ ok: true });
    expect((await verifySignature({ secret: "k", timestamp: "1000", signature: sig, body, toleranceSec: 300, nowSec: 2000 })).ok).toBe(false);
    expect((await verifySignature({ secret: "k", timestamp: "1000", signature: sig, body: body + " ", toleranceSec: 300, nowSec: 1100 })).ok).toBe(false);
  });
});

describe("自動チェック（性犯罪）", () => {
  it("正確な年齢、学校名、被告人との近しい関係を検出する", () => {
    const kinds = detectPii(
      { summary: "実の娘（15）に性的暴行を加えたとして、○○高校の教員の男に判決" },
      { isJuvenile: false, isSexCrime: true },
    ).map((x) => x.kind);
    expect(kinds).toContain("victim_age");
    expect(kinds).toContain("victim_relation");
    expect(kinds).toContain("school");
  });
  it("年代の表記は検出しない", () => {
    expect(detectPii({ summary: "10代の女性に対する不同意性交等の罪" }, { isJuvenile: false, isSexCrime: true })).toEqual([]);
  });
  it("性犯罪でなければ関係の表記は検出しない", () => {
    expect(detectPii({ summary: "娘を連れて逃走" }, { isJuvenile: false, isSexCrime: false })).toEqual([]);
  });
});

import { normalizePoliceAgency, normalizePoliceStation, normalizeProsecutorOffice } from "../src/agencies";

describe("捜査機関・検察庁の正規化", () => {
  it.each([
    ["大阪府警", "大阪府警察", "大阪府"],
    ["京都府警察本部", "京都府警察", "京都府"],
    ["神奈川県警", "神奈川県警察", "神奈川県"],
    ["警視庁", "警視庁", "東京都"],
    ["道警", "北海道警察", "北海道"],
    ["近畿厚生局麻薬取締部", "近畿厚生局麻薬取締部", null],
  ])("%s → %s（%s）", (raw, name, pref) => {
    expect(normalizePoliceAgency(raw)).toEqual({ name, prefecture: pref });
  });
  it("検察庁と警察署", () => {
    expect(normalizeProsecutorOffice("東京地検特捜部")).toBe("東京地方検察庁特捜部");
    expect(normalizeProsecutorOffice("大阪高検")).toBe("大阪高等検察庁");
    expect(normalizePoliceStation("天満警察署")).toBe("天満署");
  });
});

describe("自動チェック（性犯罪の年齢）", () => {
  const sex = { isJuvenile: false, isSexCrime: true };
  it.each(["会社員の男（45）に判決", "被告（45）は起訴内容を認めた", "45歳の会社員の男に懲役6年", "52歳の被告に判決"])(
    "被告人・被疑者の年齢は検出しない: %s",
    (summary) => expect(detectPii({ summary }, sex).filter((f) => f.kind === "victim_age")).toEqual([]),
  );
  it.each(["女性（19）に対し", "当時16歳の女性に", "男児（8）にわいせつな行為"])("被害者の年齢は検出する: %s", (summary) => {
    expect(detectPii({ summary }, sex).map((f) => f.kind)).toContain("victim_age");
  });
});

import { normalizeNationality, residenceGroup } from "../src/nationality";

describe("国籍の正規化", () => {
  it.each([
    ["ベトナム国籍", "ベトナム", "VN"],
    ["ベトナム人", "ベトナム", "VN"],
    ["中華人民共和国", "中国", "CN"],
    ["米国籍", "アメリカ", "US"],
    ["中国籍", "中国", "CN"],
    ["英国人", "イギリス", "GB"],
    ["韓国籍", "韓国", "KR"],
    ["朝鮮籍", "朝鮮", null],
    ["ジンバブエ国籍", "ジンバブエ", null],
  ])("%s → %s（%s）", (raw, name, code) => expect(normalizeNationality(raw)).toEqual({ name, code }));
  it("空や不明は null（記載なし）", () => {
    expect(normalizeNationality("")).toBeNull();
    expect(normalizeNationality("不明")).toBeNull();
  });
  it("在留資格の大分類（警察庁の区分）", () => {
    expect(residenceGroup("技能実習")).toBe("来日外国人");
    expect(residenceGroup("定住者")).toBe("来日外国人");
    expect(residenceGroup("特別永住者")).toBe("定着居住者");
    expect(residenceGroup("不明")).toBeNull();
  });
});

describe("在留資格（仮放免）", () => {
  it("仮放免は来日外国人に数える", () => expect(residenceGroup("仮放免")).toBe("来日外国人"));
});

describe("自動チェック（第3波の誤検出）", () => {
  const sex = { isJuvenile: false, isSexCrime: true };
  const kinds = (summary: string, opts = sex) => detectPii({ summary }, opts).map((f) => `${f.kind}:${f.match}`);
  it.each([
    "少女が16歳未満と知りながら性交した疑い",
    "13歳未満の教え子以外の女児に",
    "SNSで自分の年齢を24歳と偽って中学生の少女と",
    "42歳の映像クリエーターを逮捕",
    "看護師の24歳男を逮捕",
    "大学生の男2人（いずれも19歳）を逮捕",
    "監禁の罪に問われた無職の女（23）に対し",
  ])("加害者の年齢・法律の要件は年齢として検出しない: %s", (s) => {
    expect(kinds(s).filter((k) => k.startsWith("victim_age"))).toEqual([]);
  });
  it("被害者の年齢は引き続き検出する", () => {
    expect(kinds("被害に遭った女性2人は当時17歳で")).toContain("victim_age:17歳");
    expect(kinds("長女（16）に対し")).toContain("victim_age:（16）");
    expect(kinds("16歳の少女を誘拐した男を逮捕")).toContain("victim_age:16歳");
  });
  it("「児童ポルノ」「高校生の女子生徒」は関係の表現として検出しない", () => {
    expect(kinds("児童買春・児童ポルノ禁止法違反の疑い")).toEqual([]);
    expect(kinds("交際していた高校生の女子生徒に")).toEqual([]);
  });
  it("「勤務先の児童」は検出する", () => {
    expect(kinds("勤務先の児童に性的暴行")).toContain("victim_relation:勤務先の児童");
  });
  it("学年や一般的な言い方は学校名として検出しない", () => {
    const juv = { isJuvenile: true, isSexCrime: false };
    expect(kinds("座間市の高校3年の女子生徒", juv)).toEqual([]);
    expect(kinds("県内の公立高校に勤務する教員", juv)).toEqual([]);
    expect(kinds("元大学職員の男", juv)).toEqual([]);
    expect(kinds("市内の長浜北高校に通う", juv)).toContain("school:市内の長浜北高校");
  });
  it.each(["黙秘した被告に求刑超え", "盗んだ被告に拘禁刑", "犯行は組織的で被告らの役割", "対応について被告と相談", "少年が主犯格の被告とともに", "息子さんが女性を"])(
    "述語・助詞で終わる語は人名として検出しない: %s",
    (s) => expect(kinds(s, { isJuvenile: false, isSexCrime: false })).toEqual([]),
  );
  it("人名は引き続き検出する", () => {
    expect(kinds("山田太郎被告に判決", { isJuvenile: false, isSexCrime: false })).toContain("person_name:山田太郎被告");
  });
});
