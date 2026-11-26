-- Crime Watch: D1 コンソール用（migrations/0007_flag_reviews.sql）。すべて貼り付けて 1 回だけ実行する。
CREATE TABLE flag_reviews (
  parent_type    TEXT NOT NULL,
  parent_id      TEXT NOT NULL,
  reviewed_flags TEXT NOT NULL,
  decision       TEXT NOT NULL DEFAULT 'ok',
  note           TEXT,
  reviewed_at    TEXT NOT NULL,
  PRIMARY KEY (parent_type, parent_id)
);
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0007_flag_reviews.sql');
