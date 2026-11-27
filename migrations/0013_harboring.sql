-- 第3波の確認後に残った未分類「犯人隠避」への対応（分類のみ）
INSERT INTO laws (code, name, law_name, category, group_name, sort_order) VALUES
 ('harboring', '犯人蔵匿・隠避罪', '刑法103条', '刑法犯', 'その他刑法犯', 135);
INSERT OR IGNORE INTO charge_aliases (alias, law_code) VALUES
 ('犯人隠避','harboring'),('犯人蔵匿','harboring'),('犯人隠匿','harboring');
