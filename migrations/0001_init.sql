-- Crime Watch 初期スキーマ（要件定義書 §4）

-- 法律マスタ
CREATE TABLE laws (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  law_name    TEXT NOT NULL,
  category    TEXT NOT NULL,            -- '刑法犯' | '特別法犯'
  group_name  TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- 法定刑（時期ごと）。指標 A は行為時点の値で計算する
CREATE TABLE law_penalty_periods (
  law_code          TEXT NOT NULL REFERENCES laws(code),
  effective_from    TEXT NOT NULL,      -- 施行日 YYYY-MM-DD
  effective_to      TEXT,               -- この日の前日まで有効。NULL = 現行
  statutory_penalty TEXT NOT NULL,      -- 表示用の文言
  stat_min_months   INTEGER,            -- 有期刑の下限（月）
  stat_max_months   INTEGER,            -- 有期刑の上限（月）
  stat_has_death    INTEGER NOT NULL DEFAULT 0,
  stat_has_life     INTEGER NOT NULL DEFAULT 0,
  stat_max_fine_yen INTEGER,
  verified          INTEGER NOT NULL DEFAULT 0, -- e-Gov 法令検索で確認済みか
  PRIMARY KEY (law_code, effective_from)
);

-- 罪状辞書（罪状の言い方 → 法律）
CREATE TABLE charge_aliases (
  alias     TEXT PRIMARY KEY,
  law_code  TEXT NOT NULL REFERENCES laws(code)
);

-- 事件
CREATE TABLE cases (
  id            TEXT PRIMARY KEY,
  case_ref      TEXT UNIQUE NOT NULL,
  title         TEXT NOT NULL,
  summary       TEXT NOT NULL,
  occurred_on   TEXT,
  prefecture    TEXT,
  city          TEXT,
  is_juvenile   INTEGER NOT NULL DEFAULT 0,
  latest_stage  TEXT NOT NULL,
  latest_at     TEXT NOT NULL,          -- 最新の報道・判決の日時（並べ替え用）
  backfill      INTEGER NOT NULL DEFAULT 0, -- すべて過去分のとき 1
  status        TEXT NOT NULL DEFAULT 'published',
  flagged       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_cases_latest ON cases(latest_at);
CREATE INDEX idx_cases_pref ON cases(prefecture);

-- 報道
CREATE TABLE reports (
  id                 TEXT PRIMARY KEY,
  external_id        TEXT UNIQUE NOT NULL,
  case_id            TEXT NOT NULL REFERENCES cases(id),
  stage              TEXT NOT NULL,
  title              TEXT NOT NULL,
  summary            TEXT NOT NULL,
  reported_at        TEXT NOT NULL,
  occurred_on        TEXT,
  prefecture         TEXT,
  city               TEXT,
  link_confidence    TEXT,
  backfill           INTEGER NOT NULL DEFAULT 0,
  source_url         TEXT NOT NULL,
  source_name        TEXT,
  additional_sources TEXT,              -- JSON
  source_checked_at  TEXT,
  flags              TEXT,              -- JSON: 自動チェックの検出内容
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX idx_reports_case ON reports(case_id);

-- 報道に出てくる被疑者の属性（氏名は持たない）
CREATE TABLE report_persons (
  report_id      TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  seq            INTEGER NOT NULL,
  person_ref     TEXT,
  gender         TEXT,
  age            INTEGER,
  age_group      TEXT,
  juvenile_class TEXT,
  PRIMARY KEY (report_id, seq)
);
CREATE INDEX idx_report_persons_ref ON report_persons(person_ref);

-- 事件の罪状（報道ごと）
CREATE TABLE report_charges (
  report_id   TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  charge_text TEXT NOT NULL,            -- 区切った後の罪状
  raw_text    TEXT NOT NULL,            -- Muse から受け取った文字列
  law_code    TEXT REFERENCES laws(code),
  modifier    TEXT,
  matched_alias TEXT,
  PRIMARY KEY (report_id, seq)
);
CREATE INDEX idx_report_charges_law ON report_charges(law_code);

-- 裁判所・裁判官
CREATE TABLE courts (
  id         TEXT PRIMARY KEY,
  name       TEXT UNIQUE NOT NULL,
  level      TEXT NOT NULL,
  prefecture TEXT
);
CREATE TABLE judges (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  note  TEXT
);
CREATE INDEX idx_judges_name ON judges(name);

-- 判決（被告人 1 人につき 1 件）
CREATE TABLE judgments (
  id                       TEXT PRIMARY KEY,
  external_id              TEXT UNIQUE NOT NULL,
  case_id                  TEXT NOT NULL REFERENCES cases(id),
  court_id                 TEXT NOT NULL REFERENCES courts(id),
  instance                 TEXT,
  decided_on               TEXT NOT NULL,
  reported_at              TEXT,
  occurred_on              TEXT,
  link_confidence          TEXT,
  backfill                 INTEGER NOT NULL DEFAULT 0,
  lay_judge_trial          INTEGER,
  -- 刑
  sentence_type            TEXT NOT NULL,
  term_months              INTEGER,
  indeterminate_min_months INTEGER,
  indeterminate_max_months INTEGER,
  suspended_months         INTEGER,     -- NULL = 実刑
  probation                INTEGER,
  fine_yen                 INTEGER,
  detention_credit_days    INTEGER,
  other_dispositions       TEXT,
  protective_disposition   TEXT,
  demand_type              TEXT,
  demand_months            INTEGER,
  demand_fine_yen          INTEGER,
  appeal_status            TEXT,
  -- 被告人の属性（氏名は持たない）
  person_ref               TEXT,
  defendant_gender         TEXT,
  gender_inherited         INTEGER NOT NULL DEFAULT 0,
  defendant_age            INTEGER,
  defendant_age_group      TEXT,
  juvenile_class           TEXT,
  -- 量刑に影響する事情
  prior_record             TEXT,
  plea                     TEXT,
  settlement               TEXT,
  damage_yen               INTEGER,
  victim_count             INTEGER,
  harm_result              TEXT,
  adjustments              TEXT,        -- JSON
  -- 計算値（§6）
  primary_law_code         TEXT REFERENCES laws(code),
  position_in_range        REAL,
  ratio_to_demand          REAL,
  -- 出典・状態
  title                    TEXT NOT NULL,
  summary                  TEXT NOT NULL,
  source_url               TEXT NOT NULL,
  source_name              TEXT,
  additional_sources       TEXT,
  source_checked_at        TEXT,
  flags                    TEXT,
  status                   TEXT NOT NULL DEFAULT 'published',
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL
);
CREATE INDEX idx_judgments_case ON judgments(case_id);
CREATE INDEX idx_judgments_court ON judgments(court_id);
CREATE INDEX idx_judgments_law ON judgments(primary_law_code);
CREATE INDEX idx_judgments_decided ON judgments(decided_on);

CREATE TABLE judgment_judges (
  judgment_id TEXT NOT NULL REFERENCES judgments(id) ON DELETE CASCADE,
  judge_id    TEXT NOT NULL REFERENCES judges(id),
  role        TEXT NOT NULL,
  PRIMARY KEY (judgment_id, judge_id)
);
CREATE INDEX idx_judgment_judges_judge ON judgment_judges(judge_id);

CREATE TABLE judgment_charges (
  judgment_id   TEXT NOT NULL REFERENCES judgments(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  charge_text   TEXT NOT NULL,
  raw_text      TEXT NOT NULL,
  law_code      TEXT REFERENCES laws(code),
  modifier      TEXT,
  matched_alias TEXT,
  is_primary    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (judgment_id, seq)
);
CREATE INDEX idx_judgment_charges_law ON judgment_charges(law_code);

-- 受信ログ
CREATE TABLE ingest_logs (
  id          TEXT PRIMARY KEY,
  received_at TEXT NOT NULL,
  item_count  INTEGER NOT NULL,
  created     INTEGER NOT NULL,
  updated     INTEGER NOT NULL,
  rejected    INTEGER NOT NULL,
  flagged     INTEGER NOT NULL
);

-- 受信した原本（監査・再処理用）。リクエスト本文をそのまま保存する
CREATE TABLE raw_payloads (
  ingest_id   TEXT PRIMARY KEY REFERENCES ingest_logs(id),
  received_at TEXT NOT NULL,
  body        TEXT NOT NULL
);
