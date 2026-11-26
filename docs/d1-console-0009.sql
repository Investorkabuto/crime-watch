-- Crime Watch: D1 コンソール用（migrations/0009_case_progress.sql）。すべて貼り付けて 1 回だけ実行する。
ALTER TABLE cases ADD COLUMN progress TEXT;
CREATE INDEX idx_cases_progress ON cases(progress);
ALTER TABLE reports ADD COLUMN non_prosecution_reason TEXT;
INSERT INTO laws (code, name, law_name, category, group_name, sort_order) VALUES
 ('prostitution', '売春防止法違反', '売春防止法', '特別法犯', '風俗', 431);
INSERT OR IGNORE INTO charge_aliases (alias, law_code) VALUES
 ('売春防止法','prostitution'),('管理売春','prostitution'),('売春周旋','prostitution'),('売春防止','prostitution'),
 ('通貨偽造','forgery'),('偽造通貨行使','forgery'),('文書偽造','forgery');
UPDATE cases SET progress = CASE latest_stage
  WHEN '発生' THEN '捜査中' WHEN '逮捕' THEN '捜査中' WHEN '再逮捕' THEN '捜査中' WHEN '送検' THEN '捜査中'
  WHEN '起訴' THEN '公判中' WHEN '判決' THEN '判決後（未確定）' WHEN '控訴' THEN '判決後（未確定）'
  WHEN '上告' THEN '判決後（未確定）' WHEN '確定' THEN '確定' ELSE NULL END;
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0009_case_progress.sql');
