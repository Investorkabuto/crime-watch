-- Crime Watch: D1 コンソール用（migrations/0010_themes.sql）。すべて貼り付けて 1 回だけ実行する。
CREATE TABLE item_themes (
  parent_type TEXT NOT NULL,
  parent_id   TEXT NOT NULL,
  theme       TEXT NOT NULL,
  PRIMARY KEY (parent_type, parent_id, theme)
);
CREATE TABLE case_themes (
  case_id TEXT NOT NULL,
  theme   TEXT NOT NULL,
  source  TEXT NOT NULL,
  PRIMARY KEY (case_id, theme, source)
);
CREATE INDEX idx_case_themes_theme ON case_themes(theme);
ALTER TABLE report_persons ADD COLUMN public_figure TEXT;
ALTER TABLE judgments ADD COLUMN defendant_public_figure TEXT;
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0010_themes.sql');
