-- 未分類で届いた「預託法」「旅券法」への対応（分類のみ）
INSERT INTO laws (code, name, law_name, category, group_name, sort_order) VALUES
 ('deposit_transaction', '預託法違反', '預託等取引に関する法律', '特別法犯', '経済',         466),
 ('passport',            '旅券法違反', '旅券法',                 '特別法犯', 'その他特別法', 455);
INSERT OR IGNORE INTO charge_aliases (alias, law_code) VALUES
 ('預託法','deposit_transaction'),('預託等取引法','deposit_transaction'),('預託商法','deposit_transaction'),
 ('旅券法','passport');
