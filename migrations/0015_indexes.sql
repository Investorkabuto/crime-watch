-- クエリのフルスキャン解消用インデックス（D1 rows read 削減）
CREATE INDEX IF NOT EXISTS idx_cases_status_latest ON cases(status, latest_at DESC);
CREATE INDEX IF NOT EXISTS idx_cases_status_pref_latest ON cases(status, prefecture, latest_at DESC);
CREATE INDEX IF NOT EXISTS idx_cases_status_progress ON cases(status, progress);
CREATE INDEX IF NOT EXISTS idx_cases_updated ON cases(updated_at);

CREATE INDEX IF NOT EXISTS idx_reports_reported_at ON reports(reported_at);
CREATE INDEX IF NOT EXISTS idx_reports_case_reported ON reports(case_id, reported_at);

CREATE INDEX IF NOT EXISTS idx_judgments_status_decided ON judgments(status, decided_on DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_judgments_status_law ON judgments(status, primary_law_code);
CREATE INDEX IF NOT EXISTS idx_judgments_case_status ON judgments(case_id, status);

CREATE INDEX IF NOT EXISTS idx_case_themes_theme_case ON case_themes(theme, case_id);

CREATE INDEX IF NOT EXISTS idx_agg_law_pref ON agg_law_monthly(prefecture, law_code);
CREATE INDEX IF NOT EXISTS idx_agg_theme_pref ON agg_theme_monthly(prefecture, theme);
