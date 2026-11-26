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
    expect(codes(["組織犯罪処罰法違反"])[0]?.[1]).toBeNull();
  });
});
