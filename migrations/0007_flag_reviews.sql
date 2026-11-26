-- 自動チェックの検出を人が確認した記録（管理画面の「確認済み」）
-- 確認したときの検出内容（flags）を保存し、今の検出内容と同じ間だけ確認済みとして扱う。
-- 送り直しなどで検出内容が変わったら、もう一度「要確認」に出す。
CREATE TABLE flag_reviews (
  parent_type    TEXT NOT NULL,   -- 'report' | 'judgment'
  parent_id      TEXT NOT NULL,
  reviewed_flags TEXT NOT NULL,   -- 確認したときの flags（JSON）
  decision       TEXT NOT NULL DEFAULT 'ok', -- 'ok' = 問題なし
  note           TEXT,
  reviewed_at    TEXT NOT NULL,
  PRIMARY KEY (parent_type, parent_id)
);
