-- できるだけ多くの情報を残す（2026-11-27 mason の要望・もちの依頼）
-- 報道: 捜査した警察（県警・警察署）と検察庁
ALTER TABLE reports ADD COLUMN police_agency TEXT;      -- 正規化した名前（例: 大阪府警察、警視庁）
ALTER TABLE reports ADD COLUMN police_prefecture TEXT;  -- 警察の都道府県（例: 大阪府）
ALTER TABLE reports ADD COLUMN police_station TEXT;     -- 警察署（例: 天満署）。少年事件では保存しない
ALTER TABLE reports ADD COLUMN prosecutor_office TEXT;  -- 検察庁（例: 大阪地方検察庁）
-- 判決: 発生場所（これまで都道府県は受け付けても保存していなかった）と捜査・起訴した機関
ALTER TABLE judgments ADD COLUMN prefecture TEXT;       -- 発生した都道府県（裁判所の所在地とは別）
ALTER TABLE judgments ADD COLUMN city TEXT;             -- 発生した市区町村。少年事件では保存しない
ALTER TABLE judgments ADD COLUMN police_agency TEXT;
ALTER TABLE judgments ADD COLUMN police_prefecture TEXT;
ALTER TABLE judgments ADD COLUMN prosecutor_office TEXT;
CREATE INDEX idx_reports_police_pref ON reports(police_prefecture);
CREATE INDEX idx_judgments_pref ON judgments(prefecture);

-- 事件の状況（記事に書かれる範囲の粗い分類）
ALTER TABLE reports ADD COLUMN motive TEXT;              -- 動機の分類
ALTER TABLE reports ADD COLUMN weapon TEXT;              -- 凶器の分類（なし／刃物など）
ALTER TABLE reports ADD COLUMN accomplice_count INTEGER; -- 共犯者の人数（0 = 単独）
ALTER TABLE reports ADD COLUMN location_type TEXT;       -- 犯行場所の種別
ALTER TABLE judgments ADD COLUMN motive TEXT;
ALTER TABLE judgments ADD COLUMN weapon TEXT;
ALTER TABLE judgments ADD COLUMN accomplice_count INTEGER;
ALTER TABLE judgments ADD COLUMN location_type TEXT;
-- 職業の区分（報道される範囲の粗い分類）
ALTER TABLE report_persons ADD COLUMN occupation TEXT;
ALTER TABLE judgments ADD COLUMN defendant_occupation TEXT;

-- 被害者（特定につながらない粗い属性だけ。氏名・正確な年齢は持たない）
CREATE TABLE victims (
  parent_type TEXT NOT NULL,   -- 'report' | 'judgment'
  parent_id   TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  gender      TEXT,
  age_group   TEXT,            -- 年代（10代など）
  occupation  TEXT,
  relation    TEXT,            -- 被疑者・被告人との関係の分類
  PRIMARY KEY (parent_type, parent_id, seq)
);

-- 逮捕監禁（もちの試験収集で未分類になったため）
INSERT INTO laws (code, name, law_name, category, group_name, sort_order) VALUES
 ('confinement', '逮捕監禁罪', '刑法220条', '刑法犯', 'その他刑法犯', 134);
INSERT INTO law_penalty_periods (law_code, effective_from, effective_to, statutory_penalty, stat_min_months, stat_max_months, stat_has_death, stat_has_life, stat_max_fine_yen) VALUES
 ('confinement', '1900-01-01', NULL, '3月以上7年以下の拘禁刑', 3, 84, 0, 0, NULL);
INSERT OR IGNORE INTO charge_aliases (alias, law_code) VALUES
 ('逮捕監禁','confinement'),('監禁','confinement'),('不法監禁','confinement');
