-- Crime Watch: D1 コンソール用（migrations/0012_more_laws.sql）。すべて貼り付けて 1 回だけ実行する。
INSERT INTO laws (code, name, law_name, category, group_name, sort_order) VALUES
 ('sexual_image_recording', '性的姿態等撮影罪',                 '性的姿態撮影等処罰法',                     '特別法犯', '風俗',         431),
 ('child_solicitation',     '16歳未満の者に対する面会要求等罪', '刑法182条',                                '刑法犯',   '風俗犯',       121),
 ('building_damage',        '建造物損壊罪',                     '刑法260条',                                '刑法犯',   'その他刑法犯', 134),
 ('customs',                '関税法違反',                       '関税法',                                   '特別法犯', 'その他特別法', 452),
 ('criminal_proceeds',      '犯罪収益移転防止法違反',           '犯罪による収益の移転防止に関する法律',     '特別法犯', '経済',         464),
 ('bid_rigging',            '官製談合防止法違反',               '入札談合等関与行為防止法',                 '特別法犯', '経済',         465),
 ('metal_theft',            '金属盗対策法違反',                 '盗難特定金属製物品の処分の防止等に関する法律', '特別法犯', 'その他特別法', 453),
 ('explosives',             '火薬類取締法違反',                 '火薬類取締法',                             '特別法犯', '銃器・刃物',   401),
 ('arms_manufacturing',     '武器等製造法違反',                 '武器等製造法',                             '特別法犯', '銃器・刃物',   402),
 ('animal_welfare',         '動物愛護法違反',                   '動物の愛護及び管理に関する法律',           '特別法犯', 'その他特別法', 454);

INSERT OR IGNORE INTO charge_aliases (alias, law_code) VALUES
 ('性的姿態等撮影','sexual_image_recording'),('性的姿態撮影','sexual_image_recording'),('性的姿態撮影処罰法','sexual_image_recording'),
 ('性的姿態撮影等処罰法','sexual_image_recording'),('撮影罪','sexual_image_recording'),('性的影像記録','sexual_image_recording'),
 ('面会要求','child_solicitation'),('映像送信要求','child_solicitation'),
 ('建造物損壊','building_damage'),
 ('関税法','customs'),
 ('犯罪収益移転防止法','criminal_proceeds'),('犯収法','criminal_proceeds'),
 ('官製談合防止法','bid_rigging'),('官製談合','bid_rigging'),('入札談合等関与行為防止法','bid_rigging'),
 ('金属盗対策法','metal_theft'),
 ('火薬類取締法','explosives'),
 ('武器等製造法','arms_manufacturing'),
 ('動物愛護法','animal_welfare'),('動物愛護管理法','animal_welfare'),
 ('虚偽公文書作成','forgery'),('虚偽有印公文書作成','forgery'),
 ('ポルノ禁止法','child_porn');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0012_more_laws.sql');
