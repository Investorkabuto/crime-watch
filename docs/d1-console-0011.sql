-- Crime Watch: D1 コンソール用（migrations/0011_public_site.sql）。すべて貼り付けて 1 回だけ実行する。
CREATE TABLE requests (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  case_id    TEXT,
  target_url TEXT,
  body       TEXT NOT NULL,
  contact    TEXT,
  status     TEXT NOT NULL DEFAULT 'open',
  note       TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_requests_status ON requests(status, created_at);
CREATE INDEX idx_requests_case ON requests(case_id);

CREATE TABLE agg_theme_monthly (
  theme      TEXT NOT NULL,
  month      TEXT NOT NULL,
  prefecture TEXT NOT NULL,
  cases      INTEGER NOT NULL,
  PRIMARY KEY (theme, month, prefecture)
);
CREATE INDEX idx_agg_theme_month ON agg_theme_monthly(theme, month);

CREATE TABLE agg_law_monthly (
  law_code   TEXT NOT NULL,
  month      TEXT NOT NULL,
  prefecture TEXT NOT NULL,
  cases      INTEGER NOT NULL,
  PRIMARY KEY (law_code, month, prefecture)
);
CREATE INDEX idx_agg_law_month ON agg_law_monthly(law_code, month);

CREATE TABLE agg_sentence_dist (
  law_code            TEXT NOT NULL,
  instance            TEXT NOT NULL,
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

CREATE TABLE agg_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0011_public_site.sql');
