-- テーマタグ（SNS から事件を探してもらうための切り口）と著名人の区分（2026-11-27）
-- Muse が記事から付けたテーマ（報道・判決ごと）
CREATE TABLE item_themes (
  parent_type TEXT NOT NULL,   -- 'report' | 'judgment'
  parent_id   TEXT NOT NULL,
  theme       TEXT NOT NULL,
  PRIMARY KEY (parent_type, parent_id, theme)
);
-- 事件ごとのテーマ（Muse が付けたもの＋アプリがデータから自動で判定したもの）。受信のたびに計算し直す
CREATE TABLE case_themes (
  case_id TEXT NOT NULL,
  theme   TEXT NOT NULL,
  source  TEXT NOT NULL,       -- 'muse' | 'auto'
  PRIMARY KEY (case_id, theme, source)
);
CREATE INDEX idx_case_themes_theme ON case_themes(theme);
-- 著名人の区分（歌手・歌舞伎役者など）。本名・芸名は持たない
ALTER TABLE report_persons ADD COLUMN public_figure TEXT;
ALTER TABLE judgments ADD COLUMN defendant_public_figure TEXT;
