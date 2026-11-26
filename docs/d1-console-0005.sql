-- Crime Watch: D1 コンソール用（migrations/0005_more_details.sql）。すべて貼り付けて 1 回だけ実行する。
ALTER TABLE reports ADD COLUMN police_agency TEXT;
ALTER TABLE reports ADD COLUMN police_prefecture TEXT;
ALTER TABLE reports ADD COLUMN police_station TEXT;
ALTER TABLE reports ADD COLUMN prosecutor_office TEXT;
ALTER TABLE judgments ADD COLUMN prefecture TEXT;
ALTER TABLE judgments ADD COLUMN city TEXT;
ALTER TABLE judgments ADD COLUMN police_agency TEXT;
ALTER TABLE judgments ADD COLUMN police_prefecture TEXT;
ALTER TABLE judgments ADD COLUMN prosecutor_office TEXT;
CREATE INDEX idx_reports_police_pref ON reports(police_prefecture);
CREATE INDEX idx_judgments_pref ON judgments(prefecture);
ALTER TABLE reports ADD COLUMN motive TEXT;
ALTER TABLE reports ADD COLUMN weapon TEXT;
ALTER TABLE reports ADD COLUMN accomplice_count INTEGER;
ALTER TABLE reports ADD COLUMN location_type TEXT;
ALTER TABLE judgments ADD COLUMN motive TEXT;
ALTER TABLE judgments ADD COLUMN weapon TEXT;
ALTER TABLE judgments ADD COLUMN accomplice_count INTEGER;
ALTER TABLE judgments ADD COLUMN location_type TEXT;
ALTER TABLE report_persons ADD COLUMN occupation TEXT;
ALTER TABLE judgments ADD COLUMN defendant_occupation TEXT;
CREATE TABLE victims (
  parent_type TEXT NOT NULL,
  parent_id   TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  gender      TEXT,
  age_group   TEXT,
  occupation  TEXT,
  relation    TEXT,
  PRIMARY KEY (parent_type, parent_id, seq)
);
INSERT INTO laws (code, name, law_name, category, group_name, sort_order) VALUES
 ('confinement', '逮捕監禁罪', '刑法220条', '刑法犯', 'その他刑法犯', 134);
INSERT INTO law_penalty_periods (law_code, effective_from, effective_to, statutory_penalty, stat_min_months, stat_max_months, stat_has_death, stat_has_life, stat_max_fine_yen) VALUES
 ('confinement', '1900-01-01', NULL, '3月以上7年以下の拘禁刑', 3, 84, 0, 0, NULL);
INSERT OR IGNORE INTO charge_aliases (alias, law_code) VALUES
 ('逮捕監禁','confinement'),('監禁','confinement'),('不法監禁','confinement');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0005_more_details.sql');
