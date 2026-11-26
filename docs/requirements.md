# Crime Watch 要件定義書（ドラフト v0.2）

最終更新: 2026-11-26
ステータス: たたき台（「未決事項」の回答を受けて更新する）

### 変更履歴
| 版 | 日付 | 内容 |
|---|---|---|
| v0.1 | 2026-11-26 | 初版 |
| v0.2 | 2026-11-26 | 連携方式＝Muse からの送信（push）に確定。法律分類は本アプリが罪状から自動判定。全件自動公開。量刑・判決・担当裁判官のデータ化を追加 |

---

## 1. 概要

### 1.1 目的
日本国内で日々起きた犯罪の情報を集め、データとして蓄積し、**法律（罪名）ごとに分類して公開する** Web アプリケーション。
さらに、事件の**判決（量刑）と担当した裁判官**もデータにし、「どの罪で、どのくらいの刑が言い渡されているか」を見られるようにする。

### 1.2 役割分担

| 担当 | 内容 |
|---|---|
| **AI「Muse」**（本アプリの外） | ニュース・警察発表・判決報道などから情報を集め、構造化データにして**本アプリへ送信する** |
| **本アプリ（Crime Watch）** | Muse からデータを受け取り、検証・正規化し、**罪状から法律を自動で判定**して保存し、**すべて自動で公開**する |

### 1.3 スコープ
- 対象地域: **日本国内のみ**
- 対象データ: 事件（発生・逮捕・送検・起訴）と、その判決（量刑・裁判所・裁判官）
- 対象外: データの収集・要約（Muse 側の責務）、SNS への投稿

---

## 2. システム構成

公開先は **Cloudflare Workers**。周辺サービスも Cloudflare でそろえる。

```
 ┌──────────┐  HTTPS POST /api/v1/ingest     ┌───────────────────────────────┐
 │   Muse   │ ─────────────────────────────▶ │  Cloudflare Worker (API)      │
 │  (AI)    │  Authorization: Bearer <token> │  - 認証 / レート制限            │
 └──────────┘                                │  - スキーマ検証・正規化         │
                                             │  - 罪状 → 法律の自動判定        │
                                             │  - 事件・判決のひも付け         │
                                             └──────┬───────────────┬────────┘
                                                    │               │ 受信データ原本
                                                    ▼               ▼
                                             ┌────────────┐   ┌────────────┐
                                             │ D1 (SQLite) │   │ R2         │
                                             │ 事件・判決   │   │ 原本JSON    │
                                             │ 法律・裁判官 │   └────────────┘
                                             └─────┬──────┘
                                                   │
 ┌──────────┐  GET /, /laws/:code, /api/...  ┌─────▼─────────────────────────┐
 │ 閲覧者    │ ◀───────────────────────────── │  Cloudflare Worker (公開サイト)│
 └──────────┘   (Cache API / CDN キャッシュ)  │  + Static Assets (画面)        │
                                             └───────────────────────────────┘
 ┌──────────┐  Cloudflare Access で保護
 │ 管理者    │ ─────▶ /admin（事後の確認・非公開化・修正）
 └──────────┘
```

| 要素 | 採用候補 | 用途 |
|---|---|---|
| 実行環境 | Cloudflare Workers（TypeScript） | API と公開サイト |
| Web フレームワーク | Hono | ルーティング・ミドルウェア |
| DB | Cloudflare D1 | 事件・判決・法律マスタ・裁判官 |
| オブジェクトストレージ | Cloudflare R2 | 受信した JSON の原本（監査・再処理用） |
| 画面 | Workers Static Assets（SSR か SPA かは未決） | 公開サイト |
| 管理者認証 | Cloudflare Access | /admin の保護 |
| 定期処理 | Cron Triggers | 日次集計、分類できなかった罪状の集計 |
| 非同期処理（必要時） | Cloudflare Queues | 大量受信時の取り込みの分散 |

---

## 3. 機能要件

### F1. データ受信 API（Muse → 本アプリ）【確定: push 方式】
- `POST /api/v1/ingest` で 1 件または複数件（上限は例えば 100 件）を受け取る
- 1 件のデータは「事件の報道（発生・逮捕・送検・起訴）」か「判決」のどちらか（§5）
- 認証: Bearer トークン（Workers Secret に保存）。可能なら HMAC 署名も検証する
- **冪等性**: `external_id`（Muse 側 ID）で重複を判定し、同じ ID は更新として扱う。再送しても二重登録にならない
- レスポンスで件ごとの結果（`created` / `updated` / `rejected` と理由）を返す
- 受信データは原本のまま R2 に保存する

### F2. 検証・正規化
- 必須項目の確認と型の検証（スキーマは §5）
- 都道府県名を正規化する（例: 「大阪府警」→ 大阪府）
- 日付を正規化する（JST、`YYYY-MM-DD`）
- 刑期を月数に換算する（例: 「懲役2年6月」→ 30 か月）。罰金は円単位の整数にする
- 裁判所名・裁判官名を正規化する（全角・半角、空白、「地裁」→「地方裁判所」など）
- 必須項目が欠けているなど、形式として壊れているデータのみ `rejected` で返す（内容による公開停止はしない。F4）

### F3. 法律の自動判定【確定: 本アプリが罪状から判定】
- Muse は**罪状をそのままの文字列**で送る（例: `"詐欺"`、`"住居侵入・窃盗"`、`"酒気帯び運転"`、`"覚醒剤取締法違反（使用）"`）
- 本アプリは**罪状辞書**（罪状の言い方 → 法律コード）で法律を判定する
  - 例: 「詐欺」「特殊詐欺」「オレオレ詐欺」→ `fraud`／「酒気帯び運転」「ひき逃げ」→ `road_traffic`
  - 「住居侵入・窃盗」のように複数の罪状が並ぶ場合は区切って、それぞれ判定する
  - 「殺人未遂」のような未遂・幇助・共謀は、元の罪（殺人）に分類し、`attempt` などの付記を記録する
- 1 件が複数の法律に当てはまってよい（例: 強盗殺人 → 強盗罪＋殺人罪）
- 判定できなかった罪状は「未分類」として公開し、管理画面で一覧できるようにする。管理者が辞書に言い方を追加すると、過去のデータも再判定される
- 判定の根拠（どの辞書エントリに一致したか）を記録する

### F4. 自動公開【確定: 全件自動公開】
- 形式チェックを通ったデータは、**受信と同時にすべて公開する**。人による事前承認や保留はしない
- 公開サイトのキャッシュを無効化するか、短い TTL で反映させる
- 自動チェック（§8-7）に引っかかったデータも公開は止めず、**管理者に通知して事後に確認する**
- 状態: `published`（公開）/ `hidden`（管理者が非公開化）/ `deleted`（論理削除）

### F5. 事件と判決のひも付け
- 同じ事件の報道（逮捕 → 送検 → 起訴 → 判決）を **1 つの「事件（case）」にまとめる**
- まとめ方: Muse が同じ事件に同じ `case_ref`（Muse 側の事件 ID）を付けて送る（未決事項 Q1）
- 事件ページでは、時系列（逮捕日・起訴日・判決日）と、最新の段階を表示する
- 控訴審・上告審の判決も同じ事件にひも付け、審級（一審・控訴審・上告審）を記録する

### F6. 量刑・判決データ【新規】
判決ごとに次の情報を保存し、公開する。

| 項目 | 内容・例 |
|---|---|
| 裁判所 | 東京地方裁判所、大阪高等裁判所 など |
| 審級 | 一審／控訴審／上告審 |
| 判決日 | 2026-11-20 |
| 裁判官 | 裁判長・陪席裁判官の氏名と役割（裁判長／右陪席／左陪席／単独） |
| 裁判員裁判か | はい／いいえ |
| 罪状（認定された罪） | 判決で認められた罪。法律は F3 と同じ方法で判定 |
| 刑の種類 | 死刑／無期拘禁刑／有期拘禁刑／罰金／拘留／科料／無罪（2025年6月より前の判決は懲役・禁錮も記録できるようにする） |
| 刑期 | 月数で保存（例: 30 か月）。表示は「2年6月」 |
| 執行猶予 | 有無と期間（例: 4 年）、保護観察付きか |
| 罰金額 | 円 |
| 求刑 | 検察の求刑（刑の種類・刑期・罰金） |
| 未決勾留日数の算入 | 日数（任意） |
| その他 | 没収・追徴など（任意、文字列） |
| 控訴の状況 | 控訴／上告／確定／不明 |

### F7. 公開サイト
| 画面 | 内容 |
|---|---|
| トップ | 最新の事件・判決、今日・今週の件数、法律別の件数 |
| 事件一覧 | 絞り込み（日付範囲・都道府県・法律・大分類・段階）、キーワード検索、ページ送り |
| 事件詳細 | 要約・発生日・都道府県・該当法律・時系列・判決（量刑・裁判所・裁判官）・出典リンク |
| 法律別ページ | 法律の説明（条文・法定刑）、件数の推移、**量刑の分布**（刑期のばらつき、執行猶予の割合、求刑に対する判決の割合） |
| 都道府県別ページ | 都道府県ごとの件数と事件一覧 |
| 裁判所別ページ | 裁判所ごとの判決一覧と量刑の傾向 |
| **裁判官別ページ** | 担当した判決の一覧、法律ごとの量刑の傾向（件数が少ないうちは傾向表示を控える。§8） |
| 統計 | 期間 × 法律 × 都道府県の集計、法律ごとの量刑の比較 |

### F8. 管理機能（/admin、Cloudflare Access で保護）
- 事件・判決の非公開化・削除・修正（**削除依頼に素早く対応するため必須**）
- 自動チェックに引っかかったデータの事後確認
- 未分類の罪状の一覧と、罪状辞書への追加（追加後に再判定）
- 法律マスタ・裁判所マスタの編集、裁判官の名寄せ（同姓同名・表記ゆれの統合と分離）
- 受信ログの閲覧

### F9. 公開 API / フィード（任意）
- `GET /api/v1/cases`、`GET /api/v1/judgments`、`GET /api/v1/laws`、`GET /api/v1/judges/:id`、`GET /api/v1/stats`
- RSS / Atom フィード（全体・法律別・判決のみ）

---

## 4. データモデル（D1）

```
cases（事件） 1 ──── * reports（報道：発生・逮捕・送検・起訴）
   │
   ├── * case_charges（罪状 → 法律）
   │
   └── * judgments（判決） 1 ──── * judgment_judges * ──── 1 judges（裁判官）
             │                                              courts（裁判所）
             └── * judgment_charges（認定された罪 → 法律）
laws（法律マスタ） 1 ──── * charge_aliases（罪状辞書）
```

```sql
-- 法律マスタ
CREATE TABLE laws (
  code            TEXT PRIMARY KEY,   -- 例: 'theft'
  name            TEXT NOT NULL,      -- 例: '窃盗罪'
  law_name        TEXT NOT NULL,      -- 例: '刑法235条'
  category        TEXT NOT NULL,      -- '刑法犯' | '特別法犯'
  group_name      TEXT NOT NULL,      -- '凶悪犯' | '窃盗犯' | '薬物' など
  statutory_penalty TEXT,             -- 法定刑（表示用）
  sort_order      INTEGER NOT NULL DEFAULT 0
);

-- 罪状辞書（罪状の言い方 → 法律）
CREATE TABLE charge_aliases (
  alias     TEXT PRIMARY KEY,         -- 例: 'オレオレ詐欺'
  law_code  TEXT NOT NULL REFERENCES laws(code)
);

-- 事件（同じ事件の報道・判決をまとめる単位）
CREATE TABLE cases (
  id            TEXT PRIMARY KEY,     -- ULID
  case_ref      TEXT UNIQUE,          -- Muse 側の事件 ID
  title         TEXT NOT NULL,
  summary       TEXT NOT NULL,
  occurred_on   TEXT,                 -- YYYY-MM-DD
  prefecture    TEXT,
  city          TEXT,
  latest_stage  TEXT NOT NULL,        -- '発生'|'逮捕'|'送検'|'起訴'|'判決'|'確定'
  status        TEXT NOT NULL DEFAULT 'published',
  flagged       INTEGER NOT NULL DEFAULT 0,  -- 自動チェックに該当（事後確認用）
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- 報道（事件の各段階）
CREATE TABLE reports (
  id           TEXT PRIMARY KEY,
  external_id  TEXT UNIQUE NOT NULL,
  case_id      TEXT NOT NULL REFERENCES cases(id),
  stage        TEXT NOT NULL,         -- '発生'|'逮捕'|'送検'|'起訴'
  reported_at  TEXT NOT NULL,
  summary      TEXT NOT NULL,
  source_url   TEXT NOT NULL,
  source_name  TEXT
);

-- 事件の罪状
CREATE TABLE case_charges (
  case_id     TEXT NOT NULL REFERENCES cases(id),
  charge_text TEXT NOT NULL,          -- Muse から受け取った罪状の文字列
  law_code    TEXT REFERENCES laws(code),  -- NULL = 未分類
  modifier    TEXT,                   -- 'attempt'（未遂）|'accessory'（幇助）など
  PRIMARY KEY (case_id, charge_text)
);

-- 裁判所・裁判官
CREATE TABLE courts (
  id    TEXT PRIMARY KEY,
  name  TEXT UNIQUE NOT NULL,         -- 例: '東京地方裁判所'
  level TEXT NOT NULL,                -- '最高裁'|'高裁'|'地裁'|'家裁'|'簡裁'
  prefecture TEXT
);
CREATE TABLE judges (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,                -- 同姓同名がありうるので UNIQUE にしない
  note  TEXT                          -- 名寄せ用メモ
);

-- 判決
CREATE TABLE judgments (
  id                 TEXT PRIMARY KEY,
  external_id        TEXT UNIQUE NOT NULL,
  case_id            TEXT NOT NULL REFERENCES cases(id),
  court_id           TEXT NOT NULL REFERENCES courts(id),
  instance           TEXT NOT NULL,   -- '一審'|'控訴審'|'上告審'
  decided_on         TEXT NOT NULL,
  lay_judge_trial    INTEGER,         -- 裁判員裁判 1/0/NULL
  sentence_type      TEXT NOT NULL,   -- '死刑'|'無期拘禁刑'|'拘禁刑'|'懲役'|'禁錮'|'罰金'|'拘留'|'科料'|'無罪'
  term_months        INTEGER,         -- 刑期（月）
  suspended_years    INTEGER,         -- 執行猶予（年）。NULL = 実刑
  probation          INTEGER,         -- 保護観察付き 1/0
  fine_yen           INTEGER,
  demand_type        TEXT,            -- 求刑の種類
  demand_months      INTEGER,         -- 求刑の刑期（月）
  demand_fine_yen    INTEGER,
  detention_credit_days INTEGER,      -- 未決勾留日数の算入
  other_dispositions TEXT,            -- 没収・追徴など
  appeal_status      TEXT,            -- '控訴'|'上告'|'確定'|'不明'
  summary            TEXT NOT NULL,
  source_url         TEXT NOT NULL,
  source_name        TEXT,
  status             TEXT NOT NULL DEFAULT 'published'
);
CREATE TABLE judgment_judges (
  judgment_id TEXT NOT NULL REFERENCES judgments(id),
  judge_id    TEXT NOT NULL REFERENCES judges(id),
  role        TEXT NOT NULL,          -- '裁判長'|'右陪席'|'左陪席'|'単独'
  PRIMARY KEY (judgment_id, judge_id)
);
CREATE TABLE judgment_charges (
  judgment_id TEXT NOT NULL REFERENCES judgments(id),
  charge_text TEXT NOT NULL,
  law_code    TEXT REFERENCES laws(code),
  modifier    TEXT,
  PRIMARY KEY (judgment_id, charge_text)
);

-- 受信ログ
CREATE TABLE ingest_logs (
  id          TEXT PRIMARY KEY,
  received_at TEXT NOT NULL,
  item_count  INTEGER NOT NULL,
  created     INTEGER NOT NULL,
  updated     INTEGER NOT NULL,
  rejected    INTEGER NOT NULL,
  r2_key      TEXT NOT NULL
);
```

---

## 5. 受信データ仕様（Muse → 本アプリ）案

1 リクエストに `items` を複数入れられる。各 item は `type` で種類を分ける。

### 5.1 事件の報道（`type: "report"`）
```json
{
  "type": "report",
  "external_id": "muse-r-20261126-000123",
  "case_ref": "muse-case-000456",
  "stage": "逮捕",
  "title": "警察官を名乗り高齢女性から現金をだまし取った疑い 20代の男を逮捕",
  "summary": "警察官を名乗る電話で高齢女性から現金300万円をだまし取ったとして、20代の男が詐欺の疑いで逮捕された。",
  "charges": ["詐欺"],
  "occurred_on": "2026-11-20",
  "reported_at": "2026-11-26T10:30:00+09:00",
  "prefecture": "大阪府",
  "city": "大阪市",
  "source_url": "https://example.com/news/123",
  "source_name": "○○新聞"
}
```

### 5.2 判決（`type: "judgment"`）
```json
{
  "type": "judgment",
  "external_id": "muse-j-20270315-000045",
  "case_ref": "muse-case-000456",
  "court": "大阪地方裁判所",
  "instance": "一審",
  "decided_on": "2027-03-15",
  "judges": [
    { "name": "山田 太郎", "role": "裁判長" },
    { "name": "佐藤 花子", "role": "右陪席" },
    { "name": "鈴木 一郎", "role": "左陪席" }
  ],
  "lay_judge_trial": false,
  "charges": ["詐欺"],
  "sentence": {
    "type": "拘禁刑",
    "term": "3年",
    "suspended": "5年",
    "probation": false,
    "fine_yen": null
  },
  "demand": { "type": "拘禁刑", "term": "4年" },
  "appeal_status": "不明",
  "summary": "大阪地裁は、特殊詐欺の受け子として現金をだまし取った罪に問われた被告に、拘禁刑3年・執行猶予5年の判決を言い渡した。",
  "source_url": "https://example.com/news/789",
  "source_name": "○○新聞"
}
```
（裁判官名は架空の例）

| 項目 | 必須 | 説明 |
|---|---|---|
| type | ○ | `report` または `judgment` |
| external_id | ○ | Muse 側の一意な ID（冪等性に使う） |
| case_ref | ○ | Muse 側の事件 ID。同じ事件の報道・判決は同じ値にする |
| charges | ○ | 罪状の文字列の配列。法律の判定は本アプリが行う |
| title / summary | ○ | Muse が書いた文章（記事の転載は不可） |
| stage | report で○ | 発生／逮捕／送検／起訴 |
| reported_at | report で○ | 報道・発表日時 |
| prefecture | report で○ | 都道府県 |
| court / instance / decided_on / sentence | judgment で○ | 裁判所・審級・判決日・刑 |
| judges | judgment で任意 | 裁判官の氏名と役割。分かる範囲で |
| demand / appeal_status / lay_judge_trial | 任意 | 求刑・控訴状況・裁判員裁判か |
| source_url | ○ | 出典 URL |

**人名の扱い: 受け付ける人名は「裁判官」だけ。被告人・被疑者・被害者・証人などの氏名を入れる項目は設けない。**（§8）

---

## 6. 法律分類マスタ（初期案）

警察統計の区分（刑法犯／特別法犯）を大分類にし、その下に中分類 → 罪名の 3 階層とする。各法律に法定刑を持たせ、量刑と比べられるようにする（法定刑の文言は実装時に e-Gov 法令検索で確認して登録する）。

### 刑法犯
| 中分類 | 罪名（コード） |
|---|---|
| 凶悪犯 | 殺人（murder）、強盗（robbery）、放火（arson）、不同意性交等（sexual_assault） |
| 粗暴犯 | 傷害（injury）、暴行（assault）、脅迫（intimidation）、恐喝（extortion） |
| 窃盗犯 | 窃盗（theft） |
| 知能犯 | 詐欺（fraud）、横領（embezzlement）、偽造（forgery）、収賄・贈賄（bribery） |
| 風俗犯 | 不同意わいせつ（non_consensual_indecency） |
| その他刑法犯 | 公務執行妨害、住居侵入、器物損壊、略取・誘拐、過失致死傷、死体遺棄 |

### 特別法犯
| 中分類 | 法律（コード） |
|---|---|
| 交通 | 道路交通法（road_traffic）、自動車運転処罰法（dangerous_driving） |
| 薬物 | 覚醒剤取締法（stimulants）、大麻・麻薬関係（cannabis） |
| 銃器・刃物 | 銃刀法（weapons） |
| 人身安全 | ストーカー規制法（stalker）、DV 防止法（dv） |
| 福祉犯 | 児童買春・児童ポルノ禁止法（child_porn）、青少年健全育成条例（youth_ordinance） |
| 風俗 | 迷惑防止条例（nuisance_ordinance） |
| サイバー | 不正アクセス禁止法（unauthorized_access） |
| 経済 | 金融商品取引法（fin_instruments） |
| その他特別法 | 入管法（immigration）、著作権法（copyright）、公職選挙法（election） |

### 罪状辞書の例
| 罪状の言い方 | 法律コード |
|---|---|
| 詐欺、特殊詐欺、オレオレ詐欺、電子計算機使用詐欺 | fraud |
| 窃盗、万引き、空き巣、ひったくり、車上荒らし | theft |
| 強盗致傷、強盗殺人 | robbery（強盗殺人は murder も） |
| 酒気帯び運転、酒酔い運転、ひき逃げ、無免許運転、妨害運転 | road_traffic |
| 危険運転致死傷、過失運転致死傷 | dangerous_driving |
| 覚醒剤取締法違反、覚醒剤の使用・所持 | stimulants |

マスタと辞書は DB で管理し、管理画面から追加できるようにする。

---

## 7. 非機能要件

| 区分 | 要件（案） |
|---|---|
| 性能 | 公開ページは CDN キャッシュで応答 200ms 以内を目標。受信 API は 100 件/リクエストを 10 秒以内に処理 |
| 可用性 | Cloudflare のサービスレベルに従う。受信に失敗したら Muse 側で再送する（冪等なので再送しても安全） |
| セキュリティ | 受信 API はトークン認証＋レート制限。管理画面は Cloudflare Access。秘密情報は Workers Secrets |
| 監査 | 受信原本を R2 に保存。管理者の操作ログを残す |
| データ保持 | 保持期間は未決（§9） |
| コスト | まずは Workers / D1 / R2 の無料枠〜有料プランの最小構成で運用 |
| 運用 | wrangler で環境を分ける（dev / prod）、GitHub Actions でデプロイ |

---

## 8. 法的・倫理的配慮（重要）

AI が集めたデータを**人の確認なしに、すべて自動で公開する**ため、事前に止める仕組みがない。そのぶん、**受け付けるデータの形と、事後の対応**で安全を確保する。

1. **裁判官以外の個人名は載せない**: 被告人・被疑者・被害者などの氏名、顔写真、住所は受け付けず、保存もしない。逮捕されただけの人は有罪が確定しておらず、名誉毀損やプライバシー侵害の危険が大きい
2. **裁判官名の扱い**: 裁判官名は公務として行った判決についての情報として載せる。ただし、
   - 判決の結果だけを並べ、裁判官個人への評価・ランキング・「甘い」「厳しい」などの表現は出さない
   - 件数が少ない裁判官について「傾向」を表示すると誤解を招くため、一定件数（例: 20 件）未満は傾向グラフを出さない
   - 同姓同名の取り違えが起きうるので、裁判所と時期で名寄せし、管理画面で修正できるようにする
3. **少年事件**: 少年法 61 条により、本人を特定できる情報（氏名・学校名・詳しい住所など）は載せてはならない。Muse 側でも少年事件かどうかを示す項目を検討する（未決事項 Q4）
4. **推定無罪の表記**: 「逮捕」「送検」「起訴」段階、または判決が確定していない事件には「有罪が確定したものではありません」と表示する
5. **出典は必須・転載しない**: 出典 URL のないデータは受け付けない。記事本文や見出しをそのまま載せず、Muse が書いた要約と出典リンクにとどめる
6. **AI の誤りへの備え**: 「AI が自動で収集・分類した情報で、誤りを含む場合があります」と全ページに明記する。管理者がすぐに非公開化できるようにする
7. **自動チェック（公開は止めない）**: 受信時に、裁判官欄以外に人名らしき文字列・電話番号・番地までの住所などがないかを機械的に検出し、見つかったら `flagged` を立てて**管理者に通知する**。管理者が事後に確認して、必要なら非公開化する
8. **削除依頼の窓口**: 問い合わせフォームを設け、受け付けたら一時的に非公開にできる運用を用意する

※ 全件自動公開と裁判官名の掲載は、法的リスクが比較的高い組み合わせ。公開前に弁護士など専門家の確認を受けることを強く推奨する。

---

## 9. 未決事項

### 決定済み
| # | 項目 | 決定内容 |
|---|---|---|
| 済 | 連携方式 | Muse が本アプリへ送信する（push） |
| 済 | 法律の分類 | 本アプリが罪状から自動で判定する |
| 済 | 公開方式 | すべて自動で公開する（事前承認なし） |
| 済 | 量刑データ | 判決・量刑・担当裁判官をデータ化する |

### 未決
| # | 項目 | 選択肢・論点 |
|---|---|---|
| Q1 | 事件のまとめ方 | Muse が同じ事件に同じ `case_ref` を付けられるか。付けられない場合、本アプリ側で推定する（精度は下がる） |
| Q2 | 送信の頻度・量 | 1 日 1 回まとめてか、随時か。1 日あたりの件数の見込み |
| Q3 | 判決データの情報源 | ニュースの判決報道だけか、裁判所の判例検索なども使うか。裁判官名は報道に載らないことも多いので、どこから取るか |
| Q4 | 少年事件・裁判員裁判 | 少年事件を対象に含めるか。含める場合の表示ルール |
| Q5 | 対象とする事件の範囲 | 交通違反のような軽い事件も含めるか |
| Q6 | 公開範囲 | 誰でも見られる公開サイトか、限られた人向けか |
| Q7 | 画面の作り | サーバーで HTML を作る（SSR）か、SPA（React など）か。デザインの希望 |
| Q8 | データ保持期間 | 無期限か、一定期間で非公開化するか |
| Q9 | ドメイン | 独自ドメインを使うか、`*.workers.dev` か |

---

## 10. 次のステップ

1. 未決事項（§9）を決めて、本書を v0.3 に更新する
2. 受信データ仕様（§5）を確定し、Muse 側と共有する
3. 罪状辞書・法律マスタ（法定刑を含む）の初期データを作る
4. 画面イメージ（ワイヤーフレーム）を作る
5. Cloudflare プロジェクトのひな形（Hono + D1 + R2、wrangler 設定）を作る
6. 受信 API → 公開サイト → 量刑統計の順に実装する
