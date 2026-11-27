// 都道府県別人口（人口 10 万人あたり件数の算出用）
// 出典: 総務省統計局「人口推計（2024年（令和6年）10月1日現在）」総人口（単位: 千人）

export const POPULATION_SOURCE_LABEL = "総務省統計局「人口推計（2024年10月1日現在）」総人口";
export const POPULATION_SOURCE_URL = "https://www.stat.go.jp/data/jinsui/2024np/index.html";

/** 都道府県名 → 総人口（千人） */
export const PREFECTURE_POPULATION_THOUSANDS: Record<string, number> = {
  北海道: 5043,
  青森県: 1165,
  岩手県: 1145,
  宮城県: 2248,
  秋田県: 897,
  山形県: 1011,
  福島県: 1743,
  茨城県: 2806,
  栃木県: 1885,
  群馬県: 1890,
  埼玉県: 7332,
  千葉県: 6275,
  東京都: 14178,
  神奈川県: 9225,
  新潟県: 2099,
  富山県: 997,
  石川県: 1098,
  福井県: 739,
  山梨県: 791,
  長野県: 1987,
  岐阜県: 1916,
  静岡県: 3527,
  愛知県: 7460,
  三重県: 1711,
  滋賀県: 1402,
  京都府: 2520,
  大阪府: 8757,
  兵庫県: 5337,
  奈良県: 1285,
  和歌山県: 880,
  鳥取県: 531,
  島根県: 642,
  岡山県: 1831,
  広島県: 2714,
  山口県: 1281,
  徳島県: 685,
  香川県: 917,
  愛媛県: 1276,
  高知県: 656,
  福岡県: 5092,
  佐賀県: 788,
  長崎県: 1252,
  熊本県: 1697,
  大分県: 1085,
  宮崎県: 1033,
  鹿児島県: 1532,
  沖縄県: 1466,
};

/** 人口 10 万人あたりの件数（小数第 2 位まで）。対象外（不明など）は null */
export function per100k(count: number, prefecture: string): number | null {
  const popThousands = PREFECTURE_POPULATION_THOUSANDS[prefecture];
  if (!popThousands || popThousands <= 0) return null;
  // 人口 = popThousands * 1000 → 10万人あたり = count / (popThousands / 100)
  return Math.round((count / (popThousands / 100)) * 100) / 100;
}
