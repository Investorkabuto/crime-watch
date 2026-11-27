import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { classifyCharges, splitCharges, type AliasMap } from "../src/classify";
import { loadDictionary } from "../src/ingest";

let aliases: AliasMap;
beforeAll(async () => {
  aliases = (await loadDictionary(env.DB)).aliases;
});

const codes = (charges: string[]) => classifyCharges(charges, aliases).map((c) => [c.text, c.lawCode, c.modifier]);

describe("罪状の分割", () => {
  it("括弧の外の区切りだけで分ける", () => {
    expect(splitCharges("住居侵入・窃盗")).toEqual(["住居侵入", "窃盗"]);
    expect(splitCharges("覚醒剤取締法違反（使用・所持）")).toEqual(["覚醒剤取締法違反(使用・所持)"]);
    expect(splitCharges("殺人及び死体遺棄")).toEqual(["殺人", "死体遺棄"]);
  });
});

describe("法律の判定（試行の 5 分類）", () => {
  it.each([
    ["詐欺", "fraud"],
    ["特殊詐欺", "fraud"],
    ["電子計算機使用詐欺", "computer_fraud"],
    ["窃盗", "theft"],
    ["殺人", "murder"],
    ["傷害致死", "injury_death"],
    ["傷害", "injury"],
    ["強盗致傷", "robbery_injury"],
    ["強盗殺人", "robbery_murder"],
    ["酒気帯び運転", "dui"],
    ["道路交通法違反（酒気帯び運転）", "dui"],
    ["酒酔い運転", "dui_drunk"],
    ["危険運転致死", "dangerous_driving_death"],
    ["自動車運転処罰法違反（危険運転致傷）", "dangerous_driving_injury"],
    ["過失運転致死傷", "negligent_driving"],
    ["ひき逃げ", "hit_and_run"],
    ["覚せい剤取締法違反", "stimulants"],
    ["覚醒剤取締法違反（使用・所持）", "stimulants"],
    ["覚醒剤取締法違反（営利目的所持）", "stimulants_profit"],
    ["大麻取締法違反", "cannabis"],
    ["ＭＤＭＡ所持", "narcotics"],
  ])("%s → %s", (charge, law) => {
    const [c] = classifyCharges([charge], aliases);
    expect(c?.lawCode).toBe(law);
  });

  it("複数の罪状を分けて判定する", () => {
    expect(codes(["住居侵入・窃盗"])).toEqual([
      ["住居侵入", "trespass", null],
      ["窃盗", "theft", null],
    ]);
  });

  it("括弧の中に罪状が並ぶ場合は中身をそれぞれ判定する", () => {
    expect(codes(["道路交通法違反（無免許運転、酒気帯び運転）"]).map((c) => c[1])).toEqual(["unlicensed", "dui"]);
  });

  it("未遂・ほう助を付記として記録する", () => {
    expect(codes(["殺人未遂"])).toEqual([["殺人", "murder", "attempt"]]);
    expect(codes(["強盗殺人未遂"])).toEqual([["強盗殺人", "robbery_murder", "attempt"]]);
    expect(codes(["詐欺ほう助"])).toEqual([["詐欺", "fraud", "accessory"]]);
  });

  it("「の疑い」「容疑」を取り除く", () => {
    expect(codes(["詐欺の疑い"])[0]?.[1]).toBe("fraud");
    expect(codes(["窃盗容疑"])[0]?.[1]).toBe("theft");
  });

  it("前の罪状と頭が共通する省略形を補う（死体損壊・遺棄）", () => {
    expect(codes(["死体損壊・遺棄"])).toEqual([
      ["死体損壊", "corpse", null],
      ["死体遺棄", "corpse", null],
    ]);
  });

  it("辞書にない罪状は未分類（null）にする", () => {
    expect(codes(["種苗法違反"])[0]?.[1]).toBeNull();
  });
});

describe("不同意性交等（0004）", () => {
  it.each([
    ["不同意性交等", "sexual_assault"],
    ["強制性交等", "sexual_assault"],
    ["準強制性交等", "sexual_assault"],
    ["監護者性交等", "sexual_assault"],
    ["不同意性交等致傷", "sexual_assault_injury"],
    ["強姦致傷", "sexual_assault_injury"],
  ])("%s → %s", (charge, law) => {
    const [c] = classifyCharges([charge], aliases);
    expect(c?.lawCode).toBe(law);
  });
});

describe("法律名の中の「及び」", () => {
  it("麻薬及び向精神薬取締法違反を分けずに判定する", () => {
    expect(classifyCharges(["麻薬及び向精神薬取締法違反"], aliases).map((c) => c.lawCode)).toEqual(["narcotics"]);
    expect(classifyCharges(["出入国管理及び難民認定法違反"], aliases).map((c) => c.lawCode)).toEqual(["immigration"]);
  });
  it("罪状を並べる「及び」では分ける", () => {
    expect(classifyCharges(["殺人及び死体遺棄"], aliases).map((c) => c.lawCode)).toEqual(["murder", "corpse"]);
  });
  it("逮捕監禁（0005）", () => {
    expect(classifyCharges(["逮捕監禁"], aliases)[0]?.lawCode).toBe("confinement");
  });
});

describe("総称の法律（0006）", () => {
  it.each([
    ["道路交通法違反", "road_traffic_other"],
    ["道路交通法救護義務違反", "hit_and_run"],
    ["道交法違反（酒気帯び運転）", "dui"],
    ["組織犯罪処罰法違反", "organized_crime"],
    ["組織犯罪処罰法違反（組織的詐欺）", "organized_fraud"],
    ["組織犯罪処罰法違反（犯罪収益等隠匿）", "money_laundering"],
  ])("%s → %s", (charge, law) => {
    expect(classifyCharges([charge], aliases)[0]?.lawCode).toBe(law);
  });
});

describe("第2波の罪名（0009）", () => {
  it("「同行使」は直前の罪状と同じ法律", () => {
    expect(classifyCharges(["有印私文書偽造・同行使"], aliases).map((c) => [c.text, c.lawCode])).toEqual([
      ["有印私文書偽造", "forgery"],
      ["有印私文書偽造・同行使", "forgery"],
    ]);
    expect(classifyCharges(["通貨偽造・同行使"], aliases).map((c) => c.lawCode)).toEqual(["forgery", "forgery"]);
  });
  it("売春防止法", () => {
    expect(classifyCharges(["売春防止法違反（管理売春）"], aliases)[0]?.lawCode).toBe("prostitution");
    expect(classifyCharges(["売春防止法管理売春"], aliases)[0]?.lawCode).toBe("prostitution");
  });
});

describe("第3波の罪名（0012）", () => {
  it.each([
    ["性的姿態等撮影", "sexual_image_recording"],
    ["性的姿態撮影処罰法撮影", "sexual_image_recording"],
    ["16歳未満の者に対する面会要求", "child_solicitation"],
    ["16歳未満の者に対する映像送信要求", "child_solicitation"],
    ["建造物損壊", "building_damage"],
    ["関税法違反", "customs"],
    ["犯罪収益移転防止法違反", "criminal_proceeds"],
    ["官製談合防止法違反", "bid_rigging"],
    ["金属盗対策法違反", "metal_theft"],
    ["火薬類取締法違反", "explosives"],
    ["武器等製造法違反", "arms_manufacturing"],
    ["動物愛護法違反", "animal_welfare"],
    ["虚偽公文書作成", "forgery"],
    ["犯人隠避", "harboring"],
    ["預託法違反", "deposit_transaction"],
    ["旅券法違反", "passport"],
    ["児童買春・ポルノ禁止法違反（提供）", "child_porn"],
  ])("%s → %s", (raw, law) => {
    expect(classifyCharges([raw], aliases).every((c) => c.lawCode === law)).toBe(true);
  });
  it("「偽造・行使」の「行使」は直前の罪状と同じ法律", () => {
    expect(classifyCharges(["有印私文書偽造・行使"], aliases).map((c) => c.lawCode)).toEqual(["forgery", "forgery"]);
  });
});
