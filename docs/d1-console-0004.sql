-- Crime Watch: D1 コンソール用（migrations/0004_sexual_assault.sql）。すべて貼り付けて 1 回だけ実行する。
UPDATE laws SET name = '不同意性交等罪（旧 強制性交等罪・強姦罪）', law_name = '刑法177条' WHERE code = 'sexual_assault';
INSERT INTO laws (code, name, law_name, category, group_name, sort_order) VALUES
 ('sexual_assault_injury', '不同意性交等致死傷罪（旧 強制性交等致死傷罪）', '刑法181条2項', '刑法犯', '凶悪犯', 16);
INSERT INTO law_penalty_periods (law_code, effective_from, effective_to, statutory_penalty, stat_min_months, stat_max_months, stat_has_death, stat_has_life, stat_max_fine_yen) VALUES
 ('sexual_assault',        '1900-01-01', '2017-07-13', '3年以上の有期懲役（強姦罪）',            36, 240, 0, 0, NULL),
 ('sexual_assault',        '2017-07-13', '2023-07-13', '5年以上の有期懲役（強制性交等罪）',      60, 240, 0, 0, NULL),
 ('sexual_assault',        '2023-07-13', NULL,         '5年以上の有期拘禁刑（不同意性交等罪）',  60, 240, 0, 0, NULL),
 ('sexual_assault_injury', '1900-01-01', NULL,         '無期又は6年以上の拘禁刑',                72, 240, 0, 1, NULL);
INSERT OR IGNORE INTO charge_aliases (alias, law_code) VALUES
 ('準強制性交','sexual_assault'),('準強制性交等','sexual_assault'),('準強姦','sexual_assault'),
 ('監護者性交','sexual_assault'),('監護者性交等','sexual_assault'),
 ('不同意性交等致傷','sexual_assault_injury'),('不同意性交等致死','sexual_assault_injury'),
 ('強制性交等致傷','sexual_assault_injury'),('強制性交等致死','sexual_assault_injury'),
 ('強姦致傷','sexual_assault_injury'),('強姦致死','sexual_assault_injury');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0004_sexual_assault.sql');
