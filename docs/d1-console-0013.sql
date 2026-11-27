-- Crime Watch: D1 コンソール用（migrations/0013_harboring.sql）。すべて貼り付けて 1 回だけ実行する。
INSERT INTO laws (code, name, law_name, category, group_name, sort_order) VALUES
 ('harboring', '犯人蔵匿・隠避罪', '刑法103条', '刑法犯', 'その他刑法犯', 135);
INSERT OR IGNORE INTO charge_aliases (alias, law_code) VALUES
 ('犯人隠避','harboring'),('犯人蔵匿','harboring'),('犯人隠匿','harboring');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0013_harboring.sql');
