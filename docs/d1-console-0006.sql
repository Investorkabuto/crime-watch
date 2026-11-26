-- Crime Watch: D1 コンソール用（migrations/0006_more_laws.sql）。すべて貼り付けて 1 回だけ実行する。
INSERT INTO laws (code, name, law_name, category, group_name, sort_order) VALUES
 ('organized_fraud',    '組織的詐欺',                         '組織犯罪処罰法3条',  '特別法犯', '知能犯', 105),
 ('money_laundering',   '犯罪収益等隠匿（マネーロンダリング）', '組織犯罪処罰法10条', '特別法犯', '経済',   462),
 ('organized_crime',    '組織犯罪処罰法違反（その他・不明）',  '組織犯罪処罰法',     '特別法犯', '経済',   463),
 ('road_traffic_other', '道路交通法違反（その他・不明）',      '道路交通法',         '特別法犯', '交通',   208);
INSERT INTO law_penalty_periods (law_code, effective_from, effective_to, statutory_penalty, stat_min_months, stat_max_months, stat_has_death, stat_has_life, stat_max_fine_yen) VALUES
 ('organized_fraud',  '1900-01-01', NULL, '1年以上の有期拘禁刑',                                        12, 240, 0, 0, NULL),
 ('money_laundering', '1900-01-01', NULL, '5年以下の拘禁刑若しくは500万円以下の罰金（併科あり）',          1,  60, 0, 0, 5000000);
INSERT OR IGNORE INTO charge_aliases (alias, law_code) VALUES
 ('組織的詐欺','organized_fraud'),('組織犯罪処罰法詐欺','organized_fraud'),
 ('犯罪収益等隠匿','money_laundering'),('犯罪収益隠匿','money_laundering'),('マネーロンダリング','money_laundering'),
 ('組織犯罪処罰法','organized_crime'),('組織犯罪処罰','organized_crime'),('犯罪収益等収受','organized_crime'),
 ('道路交通法','road_traffic_other'),('道交法','road_traffic_other');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0006_more_laws.sql');
