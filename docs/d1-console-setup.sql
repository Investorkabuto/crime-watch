-- Crime Watch: D1 コンソール用の一括セットアップ SQL
-- migrations/0001〜0003 をまとめたもの。D1 コンソールにすべて貼り付けて 1 回だけ実行する。
-- 最後に d1_migrations へ記録するので、後で wrangler d1 migrations apply を使っても二重に実行されない。

-- ===== 0001_init.sql =====
CREATE TABLE laws (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  law_name    TEXT NOT NULL,
  category    TEXT NOT NULL,
  group_name  TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE law_penalty_periods (
  law_code          TEXT NOT NULL REFERENCES laws(code),
  effective_from    TEXT NOT NULL,
  effective_to      TEXT,
  statutory_penalty TEXT NOT NULL,
  stat_min_months   INTEGER,
  stat_max_months   INTEGER,
  stat_has_death    INTEGER NOT NULL DEFAULT 0,
  stat_has_life     INTEGER NOT NULL DEFAULT 0,
  stat_max_fine_yen INTEGER,
  verified          INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (law_code, effective_from)
);
CREATE TABLE charge_aliases (
  alias     TEXT PRIMARY KEY,
  law_code  TEXT NOT NULL REFERENCES laws(code)
);
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
  latest_at     TEXT NOT NULL,
  backfill      INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'published',
  flagged       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_cases_latest ON cases(latest_at);
CREATE INDEX idx_cases_pref ON cases(prefecture);
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
  additional_sources TEXT,
  source_checked_at  TEXT,
  flags              TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX idx_reports_case ON reports(case_id);
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
CREATE TABLE report_charges (
  report_id   TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  charge_text TEXT NOT NULL,
  raw_text    TEXT NOT NULL,
  law_code    TEXT REFERENCES laws(code),
  modifier    TEXT,
  matched_alias TEXT,
  PRIMARY KEY (report_id, seq)
);
CREATE INDEX idx_report_charges_law ON report_charges(law_code);
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
  sentence_type            TEXT NOT NULL,
  term_months              INTEGER,
  indeterminate_min_months INTEGER,
  indeterminate_max_months INTEGER,
  suspended_months         INTEGER,
  probation                INTEGER,
  fine_yen                 INTEGER,
  detention_credit_days    INTEGER,
  other_dispositions       TEXT,
  protective_disposition   TEXT,
  demand_type              TEXT,
  demand_months            INTEGER,
  demand_fine_yen          INTEGER,
  appeal_status            TEXT,
  person_ref               TEXT,
  defendant_gender         TEXT,
  gender_inherited         INTEGER NOT NULL DEFAULT 0,
  defendant_age            INTEGER,
  defendant_age_group      TEXT,
  juvenile_class           TEXT,
  prior_record             TEXT,
  plea                     TEXT,
  settlement               TEXT,
  damage_yen               INTEGER,
  victim_count             INTEGER,
  harm_result              TEXT,
  adjustments              TEXT,
  primary_law_code         TEXT REFERENCES laws(code),
  position_in_range        REAL,
  ratio_to_demand          REAL,
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
CREATE TABLE ingest_logs (
  id          TEXT PRIMARY KEY,
  received_at TEXT NOT NULL,
  item_count  INTEGER NOT NULL,
  created     INTEGER NOT NULL,
  updated     INTEGER NOT NULL,
  rejected    INTEGER NOT NULL,
  flagged     INTEGER NOT NULL
);
CREATE TABLE raw_payloads (
  ingest_id   TEXT PRIMARY KEY REFERENCES ingest_logs(id),
  received_at TEXT NOT NULL,
  body        TEXT NOT NULL
);

-- ===== 0002_seed_laws.sql =====
INSERT INTO laws (code, name, law_name, category, group_name, sort_order) VALUES
 ('fraud',                   '詐欺罪',                   '刑法246条',                     '刑法犯',   '知能犯', 100),
 ('computer_fraud',          '電子計算機使用詐欺罪',     '刑法246条の2',                  '刑法犯',   '知能犯', 101),
 ('theft',                   '窃盗罪',                   '刑法235条',                     '刑法犯',   '窃盗犯', 110),
 ('trespass',                '住居侵入等罪',             '刑法130条',                     '刑法犯',   'その他刑法犯', 111),
 ('murder',                  '殺人罪',                   '刑法199条',                     '刑法犯',   '凶悪犯', 10),
 ('injury_death',            '傷害致死罪',               '刑法205条',                     '刑法犯',   '粗暴犯', 20),
 ('injury',                  '傷害罪',                   '刑法204条',                     '刑法犯',   '粗暴犯', 21),
 ('robbery',                 '強盗罪',                   '刑法236条',                     '刑法犯',   '凶悪犯', 11),
 ('robbery_injury',          '強盗致傷罪',               '刑法240条',                     '刑法犯',   '凶悪犯', 12),
 ('robbery_murder',          '強盗殺人・強盗致死罪',     '刑法240条',                     '刑法犯',   '凶悪犯', 13),
 ('dui_drunk',               '酒酔い運転',               '道路交通法117条の2',            '特別法犯', '交通', 200),
 ('dui',                     '酒気帯び運転',             '道路交通法117条の2の2',         '特別法犯', '交通', 201),
 ('hit_and_run',             '救護義務違反（ひき逃げ）', '道路交通法117条',               '特別法犯', '交通', 202),
 ('unlicensed',              '無免許運転',               '道路交通法117条の2の2',         '特別法犯', '交通', 203),
 ('obstructive_driving',     '妨害運転（あおり運転）',   '道路交通法117条の2の2',         '特別法犯', '交通', 204),
 ('dangerous_driving_death', '危険運転致死罪',           '自動車運転処罰法2条',           '特別法犯', '交通', 205),
 ('dangerous_driving_injury','危険運転致傷罪',           '自動車運転処罰法2条',           '特別法犯', '交通', 206),
 ('negligent_driving',       '過失運転致死傷罪',         '自動車運転処罰法5条',           '特別法犯', '交通', 207),
 ('stimulants',              '覚醒剤の所持・使用等',     '覚醒剤取締法41条の2・41条の3',  '特別法犯', '薬物', 300),
 ('stimulants_profit',       '覚醒剤の営利目的所持・譲渡等', '覚醒剤取締法41条の2第2項', '特別法犯', '薬物', 301),
 ('cannabis',                '大麻の所持・使用等',       '麻薬及び向精神薬取締法（2024-12-12 前は大麻取締法）', '特別法犯', '薬物', 302),
 ('narcotics',               '麻薬の所持・使用等',       '麻薬及び向精神薬取締法',        '特別法犯', '薬物', 303);
INSERT INTO law_penalty_periods (law_code, effective_from, effective_to, statutory_penalty, stat_min_months, stat_max_months, stat_has_death, stat_has_life, stat_max_fine_yen) VALUES
 ('fraud',                   '1900-01-01', NULL, '10年以下の拘禁刑',                                  1, 120, 0, 0, NULL),
 ('computer_fraud',          '1900-01-01', NULL, '10年以下の拘禁刑',                                  1, 120, 0, 0, NULL),
 ('theft',                   '1900-01-01', NULL, '10年以下の拘禁刑又は50万円以下の罰金',              1, 120, 0, 0, 500000),
 ('trespass',                '1900-01-01', NULL, '3年以下の拘禁刑又は10万円以下の罰金',               1,  36, 0, 0, 100000),
 ('murder',                  '1900-01-01', NULL, '死刑又は無期若しくは5年以上の拘禁刑',              60, 240, 1, 1, NULL),
 ('injury_death',            '1900-01-01', NULL, '3年以上の有期拘禁刑',                              36, 240, 0, 0, NULL),
 ('injury',                  '1900-01-01', NULL, '15年以下の拘禁刑又は50万円以下の罰金',              1, 180, 0, 0, 500000),
 ('robbery',                 '1900-01-01', NULL, '5年以上の有期拘禁刑',                              60, 240, 0, 0, NULL),
 ('robbery_injury',          '1900-01-01', NULL, '無期又は6年以上の拘禁刑',                          72, 240, 0, 1, NULL),
 ('robbery_murder',          '1900-01-01', NULL, '死刑又は無期拘禁刑',                             NULL, NULL, 1, 1, NULL),
 ('dui_drunk',               '1900-01-01', NULL, '5年以下の拘禁刑又は100万円以下の罰金',              1,  60, 0, 0, 1000000),
 ('dui',                     '1900-01-01', NULL, '3年以下の拘禁刑又は50万円以下の罰金',               1,  36, 0, 0, 500000),
 ('hit_and_run',             '1900-01-01', NULL, '10年以下の拘禁刑又は100万円以下の罰金（運転者の運転に起因する場合）', 1, 120, 0, 0, 1000000),
 ('unlicensed',              '1900-01-01', NULL, '3年以下の拘禁刑又は50万円以下の罰金',               1,  36, 0, 0, 500000),
 ('obstructive_driving',     '1900-01-01', NULL, '3年以下の拘禁刑又は50万円以下の罰金（著しい危険を生じさせた場合は5年以下又は100万円以下）', 1, 36, 0, 0, 500000),
 ('dangerous_driving_death', '1900-01-01', NULL, '1年以上の有期拘禁刑',                              12, 240, 0, 0, NULL),
 ('dangerous_driving_injury','1900-01-01', NULL, '15年以下の拘禁刑',                                  1, 180, 0, 0, NULL),
 ('negligent_driving',       '1900-01-01', NULL, '7年以下の拘禁刑又は100万円以下の罰金',              1,  84, 0, 0, 1000000),
 ('stimulants',              '1900-01-01', NULL, '10年以下の拘禁刑',                                  1, 120, 0, 0, NULL),
 ('stimulants_profit',       '1900-01-01', NULL, '1年以上の有期拘禁刑（情状により500万円以下の罰金を併科）', 12, 240, 0, 0, 5000000),
 ('cannabis',                '1900-01-01', '2024-12-12', '5年以下の懲役（大麻取締法・所持）',         1,  60, 0, 0, NULL),
 ('cannabis',                '2024-12-12', NULL, '7年以下の拘禁刑（麻向法・所持・使用）',             1,  84, 0, 0, NULL),
 ('narcotics',               '1900-01-01', NULL, '7年以下の拘禁刑（ヘロイン以外の麻薬の所持・使用）', 1,  84, 0, 0, NULL);
INSERT INTO laws (code, name, law_name, category, group_name, sort_order) VALUES
 ('arson',                    '放火罪',                         '刑法108条〜',                  '刑法犯',   '凶悪犯', 14),
 ('sexual_assault',           '不同意性交等罪',                 '刑法177条',                    '刑法犯',   '凶悪犯', 15),
 ('assault',                  '暴行罪',                         '刑法208条',                    '刑法犯',   '粗暴犯', 22),
 ('intimidation',             '脅迫罪',                         '刑法222条',                    '刑法犯',   '粗暴犯', 23),
 ('extortion',                '恐喝罪',                         '刑法249条',                    '刑法犯',   '粗暴犯', 24),
 ('embezzlement',             '横領罪',                         '刑法252条〜',                  '刑法犯',   '知能犯', 102),
 ('forgery',                  '偽造罪',                         '刑法148条〜',                  '刑法犯',   '知能犯', 103),
 ('bribery',                  '収賄・贈賄罪',                   '刑法197条〜',                  '刑法犯',   '知能犯', 104),
 ('non_consensual_indecency', '不同意わいせつ罪',               '刑法176条',                    '刑法犯',   '風俗犯', 120),
 ('obstruction',              '公務執行妨害罪',                 '刑法95条',                     '刑法犯',   'その他刑法犯', 130),
 ('property_damage',          '器物損壊罪',                     '刑法261条',                    '刑法犯',   'その他刑法犯', 131),
 ('abduction',                '略取・誘拐罪',                   '刑法224条〜',                  '刑法犯',   'その他刑法犯', 132),
 ('corpse',                   '死体遺棄・損壊罪',               '刑法190条',                    '刑法犯',   'その他刑法犯', 133),
 ('weapons',                  '銃刀法違反',                     '銃砲刀剣類所持等取締法',       '特別法犯', '銃器・刃物', 400),
 ('stalker',                  'ストーカー規制法違反',           'ストーカー規制法',             '特別法犯', '人身安全', 410),
 ('child_porn',               '児童買春・児童ポルノ禁止法違反', '児童買春・児童ポルノ禁止法',   '特別法犯', '福祉犯', 420),
 ('youth_ordinance',          '青少年健全育成条例違反',         '各都道府県条例',               '特別法犯', '福祉犯', 421),
 ('nuisance_ordinance',       '迷惑防止条例違反',               '各都道府県条例',               '特別法犯', '風俗', 430),
 ('unauthorized_access',      '不正アクセス禁止法違反',         '不正アクセス禁止法',           '特別法犯', 'サイバー', 440),
 ('immigration',              '入管法違反',                     '出入国管理及び難民認定法',     '特別法犯', 'その他特別法', 450),
 ('copyright',                '著作権法違反',                   '著作権法',                     '特別法犯', 'その他特別法', 451),
 ('fin_instruments',          '金融商品取引法違反',             '金融商品取引法',               '特別法犯', '経済', 460),
 ('election',                 '公職選挙法違反',                 '公職選挙法',                   '特別法犯', 'その他特別法', 461);
INSERT INTO charge_aliases (alias, law_code) VALUES
 ('詐欺','fraud'),('特殊詐欺','fraud'),('オレオレ詐欺','fraud'),('還付金詐欺','fraud'),('架空請求詐欺','fraud'),
 ('投資詐欺','fraud'),('ロマンス詐欺','fraud'),('なりすまし詐欺','fraud'),
 ('電子計算機使用詐欺','computer_fraud'),
 ('窃盗','theft'),('万引き','theft'),('空き巣','theft'),('ひったくり','theft'),('車上荒らし','theft'),
 ('置き引き','theft'),('事務所荒らし','theft'),('忍び込み','theft'),
 ('住居侵入','trespass'),('建造物侵入','trespass'),('邸宅侵入','trespass'),
 ('殺人','murder'),
 ('傷害致死','injury_death'),
 ('傷害','injury'),
 ('強盗','robbery'),('事後強盗','robbery'),
 ('強盗致傷','robbery_injury'),('強盗傷人','robbery_injury'),('強盗傷害','robbery_injury'),
 ('強盗殺人','robbery_murder'),('強盗致死','robbery_murder'),
 ('酒酔い運転','dui_drunk'),
 ('酒気帯び運転','dui'),('飲酒運転','dui'),
 ('ひき逃げ','hit_and_run'),('救護義務','hit_and_run'),('救護措置義務','hit_and_run'),
 ('無免許運転','unlicensed'),('無免許','unlicensed'),
 ('妨害運転','obstructive_driving'),('あおり運転','obstructive_driving'),
 ('危険運転致死','dangerous_driving_death'),('危険運転致死傷','dangerous_driving_death'),
 ('危険運転致傷','dangerous_driving_injury'),
 ('過失運転致死','negligent_driving'),('過失運転致傷','negligent_driving'),('過失運転致死傷','negligent_driving'),
 ('覚醒剤','stimulants'),('覚醒剤取締法','stimulants'),
 ('大麻','cannabis'),('大麻取締法','cannabis'),('大麻草','cannabis'),
 ('麻薬','narcotics'),('麻薬及び向精神薬取締法','narcotics'),('麻向法','narcotics'),('麻薬取締法','narcotics'),
 ('コカイン','narcotics'),('MDMA','narcotics'),
 ('放火','arson'),('現住建造物等放火','arson'),
 ('不同意性交','sexual_assault'),('不同意性交等','sexual_assault'),('強制性交','sexual_assault'),('強制性交等','sexual_assault'),('強姦','sexual_assault'),
 ('暴行','assault'),('脅迫','intimidation'),('恐喝','extortion'),
 ('横領','embezzlement'),('業務上横領','embezzlement'),('着服','embezzlement'),
 ('偽造','forgery'),('有印私文書偽造','forgery'),('有印公文書偽造','forgery'),
 ('収賄','bribery'),('贈賄','bribery'),('受託収賄','bribery'),
 ('不同意わいせつ','non_consensual_indecency'),('強制わいせつ','non_consensual_indecency'),
 ('公務執行妨害','obstruction'),('器物損壊','property_damage'),
 ('誘拐','abduction'),('略取','abduction'),('未成年者誘拐','abduction'),
 ('死体遺棄','corpse'),('死体損壊','corpse'),
 ('銃刀法','weapons'),('銃砲刀剣類所持等取締法','weapons'),
 ('ストーカー規制法','stalker'),('ストーカー行為等の規制等に関する法律','stalker'),
 ('児童ポルノ','child_porn'),('児童買春','child_porn'),('児童買春・児童ポルノ禁止法','child_porn'),
 ('青少年健全育成条例','youth_ordinance'),
 ('迷惑防止条例','nuisance_ordinance'),('痴漢','nuisance_ordinance'),
 ('不正アクセス禁止法','unauthorized_access'),('不正アクセス','unauthorized_access'),
 ('入管法','immigration'),('出入国管理及び難民認定法','immigration'),('不法残留','immigration'),('不法在留','immigration'),
 ('著作権法','copyright'),('金融商品取引法','fin_instruments'),('金商法','fin_instruments'),('公職選挙法','election'),('公選法','election');

-- ===== 0003_report_person_plea.sql =====
ALTER TABLE report_persons ADD COLUMN plea TEXT;

-- ===== 適用済みの記録（wrangler のマイグレーション管理用） =====
CREATE TABLE IF NOT EXISTS d1_migrations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0001_init.sql'), ('0002_seed_laws.sql'), ('0003_report_person_plea.sql');
