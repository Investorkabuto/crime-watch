-- 「発生→逮捕→起訴→判決→確定」と報道が出るたびに段階を足していく運用のための変更（2026-11-27）
-- 事件の進み具合（最新の段階から計算する。捜査中／公判中／判決後（未確定）／確定／不起訴 など）
ALTER TABLE cases ADD COLUMN progress TEXT;
CREATE INDEX idx_cases_progress ON cases(progress);
-- 不起訴の理由（記事に書かれていれば。起訴猶予／嫌疑不十分／嫌疑なし／不明）
ALTER TABLE reports ADD COLUMN non_prosecution_reason TEXT;

-- 第2波で未分類になった罪名
INSERT INTO laws (code, name, law_name, category, group_name, sort_order) VALUES
 ('prostitution', '売春防止法違反', '売春防止法', '特別法犯', '風俗', 431);
INSERT OR IGNORE INTO charge_aliases (alias, law_code) VALUES
 ('売春防止法','prostitution'),('管理売春','prostitution'),('売春周旋','prostitution'),('売春防止','prostitution'),
 ('通貨偽造','forgery'),('偽造通貨行使','forgery'),('文書偽造','forgery');

-- 既存の事件の進み具合を計算しておく（以降はアプリが受信のたびに更新する）
UPDATE cases SET progress = CASE latest_stage
  WHEN '発生' THEN '捜査中' WHEN '逮捕' THEN '捜査中' WHEN '再逮捕' THEN '捜査中' WHEN '送検' THEN '捜査中'
  WHEN '起訴' THEN '公判中' WHEN '判決' THEN '判決後（未確定）' WHEN '控訴' THEN '判決後（未確定）'
  WHEN '上告' THEN '判決後（未確定）' WHEN '確定' THEN '確定' ELSE NULL END;
