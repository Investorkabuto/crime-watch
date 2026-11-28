-- 検証用の項目（公開しない）。出典が消えても確かめられるように、Web アーカイブの URL と、根拠の一文（記事の短い引用、300 字まで）を持つ
ALTER TABLE reports ADD COLUMN archive_url TEXT;
ALTER TABLE reports ADD COLUMN evidence_quote TEXT;
ALTER TABLE judgments ADD COLUMN archive_url TEXT;
ALTER TABLE judgments ADD COLUMN evidence_quote TEXT;
