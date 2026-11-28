-- Crime Watch: D1 コンソール用（migrations/0017_more_laws.sql）。すべて貼り付けて 1 回だけ実行する。
INSERT INTO laws (code, name, law_name, category, group_name, sort_order) VALUES
 ('false_notarial_record',    '公正証書原本不実記載等罪',   '刑法157条',                     '刑法犯',   '知能犯',       106),
 ('abandonment',              '遺棄罪（保護責任者遺棄等）', '刑法217条〜219条',              '刑法犯',   'その他刑法犯', 136),
 ('professional_negligence',  '業務上過失致死傷罪',         '刑法211条',                     '刑法犯',   'その他刑法犯', 137),
 ('coercion',                 '強要罪',                     '刑法223条',                     '刑法犯',   '粗暴犯',       25),
 ('business_obstruction',     '業務妨害罪',                 '刑法233条・234条',              '刑法犯',   'その他刑法犯', 138),
 ('defamation',               '名誉毀損罪',                 '刑法230条',                     '刑法犯',   'その他刑法犯', 139),
 ('weapon_assembly',          '凶器準備集合罪',             '刑法208条の2',                  '刑法犯',   '粗暴犯',       26),
 ('explosives_control',       '爆発物取締罰則違反',         '爆発物取締罰則',                '特別法犯', '銃器・刃物',   403),
 ('tax_evasion',              '脱税（所得税法違反など）',   '所得税法・法人税法・消費税法など', '特別法犯', '経済',     467),
 ('ticket_resale',            'チケット不正転売禁止法違反', '特定興行入場券の不正転売の禁止等による興行入場券の適正な流通の確保に関する法律', '特別法犯', '経済', 468),
 ('investment_act',           '出資法違反',                 '出資の受入れ、預り金及び金利等の取締りに関する法律', '特別法犯', '経済', 469),
 ('my_number',                'マイナンバー法違反',         '行政手続における特定の個人を識別するための番号の利用等に関する法律', '特別法犯', 'その他特別法', 456);

INSERT OR IGNORE INTO charge_aliases (alias, law_code) VALUES
 ('公正証書原本不実記載','false_notarial_record'),('電磁的公正証書原本不実記録','false_notarial_record'),('公正証書原本不実記録','false_notarial_record'),
 ('免状不実記載','false_notarial_record'),('旅券不実記載','false_notarial_record'),
 ('保護責任者遺棄','abandonment'),('遺棄致死','abandonment'),('遺棄致傷','abandonment'),
 ('業務上過失致死傷','professional_negligence'),('業務上過失致死','professional_negligence'),('業務上過失傷害','professional_negligence'),('重過失致死傷','professional_negligence'),
 ('強要','coercion'),
 ('威力業務妨害','business_obstruction'),('偽計業務妨害','business_obstruction'),('業務妨害','business_obstruction'),
 ('名誉毀損','defamation'),('名誉棄損','defamation'),
 ('凶器準備集合','weapon_assembly'),('兇器準備集合','weapon_assembly'),
 ('爆発物取締罰則','explosives_control'),
 ('所得税法','tax_evasion'),('法人税法','tax_evasion'),('消費税法','tax_evasion'),('相続税法','tax_evasion'),('地方税法','tax_evasion'),('脱税','tax_evasion'),
 ('チケット不正転売禁止法','ticket_resale'),('チケット転売禁止法','ticket_resale'),
 ('出資法','investment_act'),('出資の受入れ','investment_act'),('預り金','investment_act'),('金利等の取締り','investment_act'),
 ('マイナンバー法','my_number'),('番号利用法','my_number'),('行政手続における特定の個人を識別するための番号の利用等に関する法律','my_number'),
 ('組織的な犯罪の処罰','organized_crime'),
 ('監護者性交等','sexual_assault'),('監護者わいせつ','non_consensual_indecency'),
 ('逮捕致傷','confinement'),('逮捕致死','confinement'),('監禁致傷','confinement'),
 ('有印私文書行使','forgery'),('偽造有印私文書行使','forgery'),('有印公文書行使','forgery'),
 ('少年保護育成条例','youth_ordinance'),('青少年保護育成条例','youth_ordinance');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0017_more_laws.sql');
