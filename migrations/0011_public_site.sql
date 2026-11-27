-- 公開サイト用テーブル（削除・訂正依頼、定期集計テーブル）

-- 削除・訂正の依頼（/contact から受付。自動非公開にはせず管理者が確認して判断する）
CREATE TABLE requests (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,            -- 'correction' | 'removal' | 'other'
  case_id    TEXT,                     -- 対象の事件 ID（URL から抽出できた場合）
  target_url TEXT,
  body       TEXT NOT NULL,
  contact    TEXT,
  status     TEXT NOT NULL DEFAULT 'open', -- 'open' | 'resolved' | 'dismissed'
  note       TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_requests_status ON requests(status, created_at);
CREATE INDEX idx_requests_case ON requests(case_id);

-- 集計テーブル（Cron で 1 時間ごとに作り直す。非公開の事件は含めない）
CREATE TABLE agg_theme_monthly (
  theme      TEXT NOT NULL,
  month      TEXT NOT NULL,            -- YYYY-MM
  prefecture TEXT NOT NULL,            -- 都道府県名 または '不明'
  cases      INTEGER NOT NULL,
  PRIMARY KEY (theme, month, prefecture)
);
CREATE INDEX idx_agg_theme_month ON agg_theme_monthly(theme, month);

CREATE TABLE agg_law_monthly (
  law_code   TEXT NOT NULL,
  month      TEXT NOT NULL,            -- YYYY-MM
  prefecture TEXT NOT NULL,
  cases      INTEGER NOT NULL,
  PRIMARY KEY (law_code, month, prefecture)
);
CREATE INDEX idx_agg_law_month ON agg_law_monthly(law_code, month);

-- 法律 × 審級（'*' は全審級）ごとの刑期分布（成人の有期拘禁刑/懲役/禁錮）
CREATE TABLE agg_sentence_dist (
  law_code            TEXT NOT NULL,
  instance            TEXT NOT NULL,   -- '一審' | '控訴審' | ... | '*'
  n                   INTEGER NOT NULL,
  min_months          REAL,
  p25_months          REAL,
  median_months       REAL,
  p75_months          REAL,
  max_months          REAL,
  suspended_n         INTEGER NOT NULL DEFAULT 0,
  custodial_n         INTEGER NOT NULL DEFAULT 0,
  avg_ratio_to_demand REAL,
  n_ratio_to_demand   INTEGER NOT NULL DEFAULT 0,
  computed_at         TEXT NOT NULL,
  PRIMARY KEY (law_code, instance)
);

-- 集計メタ情報（最終集計時刻など）
CREATE TABLE agg_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
