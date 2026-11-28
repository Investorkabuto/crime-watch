-- 「嘱託殺人」「承諾殺人」が殺人罪（刑法199条）に分類されていた誤りの修正。
-- 自殺関与・同意殺人罪（刑法202条）は法定刑が「6月以上7年以下の拘禁刑」で、殺人罪とは大きく違うため別の法律にする。
INSERT INTO laws (code, name, law_name, category, group_name, sort_order) VALUES
 ('consent_murder', '自殺関与・同意殺人罪', '刑法202条', '刑法犯', '凶悪犯', 12);
INSERT INTO law_penalty_periods (law_code, effective_from, effective_to, statutory_penalty, stat_min_months, stat_max_months, stat_has_death, stat_has_life, stat_max_fine_yen) VALUES
 ('consent_murder', '1900-01-01', NULL, '6月以上7年以下の拘禁刑', 6, 84, 0, 0, NULL);
INSERT OR IGNORE INTO charge_aliases (alias, law_code) VALUES
 ('嘱託殺人','consent_murder'),('承諾殺人','consent_murder'),('同意殺人','consent_murder'),
 ('自殺ほう助','consent_murder'),('自殺幇助','consent_murder'),('自殺教唆','consent_murder'),('自殺関与','consent_murder');
