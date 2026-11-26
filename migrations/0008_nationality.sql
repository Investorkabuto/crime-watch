-- 被疑者・被告人の国籍と在留資格（2026-11-27 mason の要望：外国人犯罪の国籍別データ）
-- 記事に明記された国籍だけを記録する。書かれていないものは NULL（＝記載なし）で、「日本国籍」とはみなさない。
ALTER TABLE report_persons ADD COLUMN nationality TEXT;          -- 表示名（例: ベトナム）
ALTER TABLE report_persons ADD COLUMN nationality_code TEXT;     -- ISO 3166-1 alpha-2（例: VN）。分からなければ NULL
ALTER TABLE report_persons ADD COLUMN residence_status TEXT;     -- 在留資格の区分（例: 技能実習）
ALTER TABLE judgments ADD COLUMN defendant_nationality TEXT;
ALTER TABLE judgments ADD COLUMN defendant_nationality_code TEXT;
ALTER TABLE judgments ADD COLUMN defendant_residence_status TEXT;
ALTER TABLE judgments ADD COLUMN nationality_inherited INTEGER NOT NULL DEFAULT 0; -- 逮捕報道から引き継いだ値
CREATE INDEX idx_report_persons_nat ON report_persons(nationality);
CREATE INDEX idx_judgments_nat ON judgments(defendant_nationality);
