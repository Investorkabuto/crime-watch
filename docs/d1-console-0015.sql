-- Crime Watch: D1 コンソール用（migrations/0015_public_assistance.sql）。すべて貼り付けて 1 回だけ実行する。
INSERT INTO laws (code, name, law_name, category, group_name, sort_order) VALUES
 ('public_assistance', '生活保護法違反', '生活保護法', '特別法犯', '福祉犯', 422);
INSERT OR IGNORE INTO charge_aliases (alias, law_code) VALUES
 ('生活保護法','public_assistance'),('生活保護費の不正受給','public_assistance'),('生活保護の不正受給','public_assistance');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0015_public_assistance.sql');
