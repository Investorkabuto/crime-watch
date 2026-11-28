-- Crime Watch: D1 コンソール用（migrations/0019_evidence.sql）。すべて貼り付けて 1 回だけ実行する。マージの前に実行して構わない（古いコードは新しい列を使わない）。
ALTER TABLE reports ADD COLUMN archive_url TEXT;
ALTER TABLE reports ADD COLUMN evidence_quote TEXT;
ALTER TABLE judgments ADD COLUMN archive_url TEXT;
ALTER TABLE judgments ADD COLUMN evidence_quote TEXT;
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0019_evidence.sql');
