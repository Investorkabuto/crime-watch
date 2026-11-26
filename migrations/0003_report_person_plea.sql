-- 報道の被疑者ごとの認否（容疑を認めているか）。判決の factors.plea と同じ値を使う
ALTER TABLE report_persons ADD COLUMN plea TEXT;
