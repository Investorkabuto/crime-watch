-- Crime Watch: D1 コンソール用（migrations/0008_nationality.sql）。すべて貼り付けて 1 回だけ実行する。
ALTER TABLE report_persons ADD COLUMN nationality TEXT;
ALTER TABLE report_persons ADD COLUMN nationality_code TEXT;
ALTER TABLE report_persons ADD COLUMN residence_status TEXT;
ALTER TABLE judgments ADD COLUMN defendant_nationality TEXT;
ALTER TABLE judgments ADD COLUMN defendant_nationality_code TEXT;
ALTER TABLE judgments ADD COLUMN defendant_residence_status TEXT;
ALTER TABLE judgments ADD COLUMN nationality_inherited INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_report_persons_nat ON report_persons(nationality);
CREATE INDEX idx_judgments_nat ON judgments(defendant_nationality);
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0008_nationality.sql');
