-- テーマ「生活保護不正受給」の追加に合わせて、生活保護法違反を分類できるようにする（分類のみ）
INSERT INTO laws (code, name, law_name, category, group_name, sort_order) VALUES
 ('public_assistance', '生活保護法違反', '生活保護法', '特別法犯', '福祉犯', 422);
INSERT OR IGNORE INTO charge_aliases (alias, law_code) VALUES
 ('生活保護法','public_assistance'),('生活保護費の不正受給','public_assistance'),('生活保護の不正受給','public_assistance');
