# Crime Watch 要件定義書（ドラフト v0.1）

最終更新: 2026-11-26
ステータス: たたき台（「未決事項」の回答を受けて更新する）

---

## 1. 概要

### 1.1 目的
日本国内で日々起きた犯罪の情報を集め、データとして蓄積し、**法律（罪名）ごとに分類して公開する** Web アプリケーション。

### 1.2 役割分担

| 担当 | 内容 |
|---|---|
| **AI「Muse」**（本アプリの外） | ニュース・警察発表などから犯罪情報を集め、構造化データにして本アプリへ送る |
| **本アプリ（Crime Watch）** | Muse からデータを受け取り、検証・正規化・分類・保存し、**自動で公開**する |

### 1.3 スコープ
- 対象地域: **日本国内のみ**
- 対象外: データの収集・要約（Muse 側の責務）、SNS への投稿

---

## 2. システム構成

公開先は **Cloudflare Workers**。周辺サービスも Cloudflare でそろえる。

```
 ┌──────────┐  HTTPS POST /api/v1/ingest     ┌───────────────────────────────┐
 │   Muse   │ ─────────────────────────────▶ │  Cloudflare Worker (API)      │
 │  (AI)    │  Authorization: Bearer <token> │  - 認証 / レート制限            │
 └──────────┘                                │  - スキーマ検証・正規化         │
                                             │  - 法律コード照合・分類         │
                                             └──────┬───────────────┬────────┘
                                                    │               │ 受信データ原本
                                                    ▼               ▼
                                             ┌────────────┐   ┌────────────┐
                                             │ D1 (SQLite) │   │ R2         │
                                             │ 事件・法律  │   │ 原本JSON    │
                                             └─────┬──────┘   └────────────┘
                                                   │
 ┌──────────┐  GET /, /laws/:code, /api/...  ┌─────▼─────────────────────────┐
 │ 閲覧者    │ ◀───────────────────────────── │  Cloudflare Worker (公開サイト)│
 └──────────┘   (Cache API / CDN キャッシュ)  │  + Static Assets (画面)        │
                                             └───────────────────────────────┘
 ┌──────────┐  Cloudflare Access で保護
 │ 管理者    │ ─────▶ /admin（非公開化・削除・修正）
 └──────────┘
```

| 要素 | 採用候補 | 用途 |
|---|---|---|
| 実行環境 | Cloudflare Workers（TypeScript） | API と公開サイト |
| Web フレームワーク | Hono | ルーティング・ミドルウェア |
| DB | Cloudflare D1 | 事件・法律マスタ・分類結果 |
| オブジェクトストレージ | Cloudflare R2 | 受信した JSON の原本（監査・再処理用） |
| 画面 | Workers Static Assets（SSR か SPA かは未決） | 公開サイト |
| 管理者認証 | Cloudflare Access | /admin の保護 |
| 定期処理 | Cron Triggers | 日次集計、保存期間を過ぎたデータの整理 |
| 非同期処理（必要時） | Cloudflare Queues | 大量受信時の取り込みの分散 |

---

## 3. 機能要件

### F1. データ受信 API（Muse → 本アプリ）
- `POST /api/v1/ingest` で 1 件または複数件（上限は例えば 100 件）を受け取る
- 認証: Bearer トークン（Workers Secret に保存）。可能なら HMAC 署名も検証する
- **冪等性**: `external_id`（Muse 側 ID）または `source_url` で重複を判定し、同じデータは更新として扱う
- レスポンスで件ごとの結果（`created` / `updated` / `rejected` と理由）を返す
- 受信データは原本のまま R2 に保存する

### F2. 検証・正規化
- 必須項目の確認と型の検証（スキーマは §5）
- 都道府県名を正規化する（例: 「大阪府警」→ 大阪府）
- 日付を正規化する（JST、`YYYY-MM-DD`）
- 出典 URL の形式を確認する
- 検証に失敗したデータは公開せず、「隔離（quarantine）」状態で保存する

### F3. 法律分類
- Muse が送る法律コード（`law_codes`）を、本アプリの**法律マスタ**（§6）と照合する
- マスタにないコードや、コードが空の場合は、本アプリ側で**キーワードによる補完分類**を行う（どちらを優先するかは未決）
- 1 件の事件が複数の法律に当てはまってもよい（例: 強盗殺人 → 強盗罪＋殺人罪）
- 分類の根拠（Muse 指定か、キーワード一致か）を記録する

### F4. 自動公開
- 検証を通ったデータは、**受信と同時に `published` として公開する**
- 公開サイトのキャッシュを無効化するか、短い TTL で反映させる
- 状態の流れ: `published`（公開）/ `quarantined`（検証NG）/ `hidden`（管理者が非公開化）/ `deleted`（論理削除）

### F5. 公開サイト
| 画面 | 内容 |
|---|---|
| トップ | 最新の事件一覧、今日・今週の件数、法律別の件数 |
| 事件一覧 | 絞り込み（日付範囲・都道府県・法律・大分類）、キーワード検索、ページ送り |
| 事件詳細 | 見出し・要約・発生日・都道府県・該当法律・出典リンク |
| 法律別ページ | 法律ごとの説明（条文番号）、件数の推移、該当事件の一覧 |
| 都道府県別ページ | 都道府県ごとの件数と事件一覧 |
| 統計 | 期間 × 法律 × 都道府県の集計グラフ |

### F6. 管理機能（/admin、Cloudflare Access で保護）
- 事件の非公開化・削除・修正（**削除依頼に素早く対応するため必須**）
- 隔離データの確認と、承認して公開する操作
- 法律マスタの追加・編集
- 受信ログの閲覧

### F7. 公開 API / フィード（任意）
- `GET /api/v1/incidents`、`GET /api/v1/laws`、`GET /api/v1/stats`
- RSS / Atom フィード（全体・法律別）

---

## 4. データモデル（D1）

```sql
-- 法律マスタ
CREATE TABLE laws (
  code        TEXT PRIMARY KEY,      -- 例: 'theft'
  name        TEXT NOT NULL,         -- 例: '窃盗罪'
  law_name    TEXT NOT NULL,         -- 例: '刑法235条'
  category    TEXT NOT NULL,         -- '刑法犯' | '特別法犯'
  group_name  TEXT NOT NULL,         -- '凶悪犯' | '窃盗犯' | '薬物' など
  keywords    TEXT NOT NULL DEFAULT '[]', -- 補完分類用（JSON配列）
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- 事件
CREATE TABLE incidents (
  id            TEXT PRIMARY KEY,    -- ULID
  external_id   TEXT UNIQUE,         -- Muse 側 ID
  title         TEXT NOT NULL,
  summary       TEXT NOT NULL,
  occurred_on   TEXT,                -- YYYY-MM-DD（不明なら NULL）
  reported_at   TEXT NOT NULL,       -- 報道・発表日時
  prefecture    TEXT,                -- 正規化済み都道府県名
  city          TEXT,
  stage         TEXT,                -- '発生' | '逮捕' | '送検' | '起訴' | '判決' など
  source_url    TEXT NOT NULL,
  source_name   TEXT,
  status        TEXT NOT NULL DEFAULT 'published',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_incidents_source_url ON incidents(source_url);
CREATE INDEX idx_incidents_date ON incidents(occurred_on);
CREATE INDEX idx_incidents_pref ON incidents(prefecture);

-- 事件と法律の対応（多対多）
CREATE TABLE incident_laws (
  incident_id TEXT NOT NULL REFERENCES incidents(id),
  law_code    TEXT NOT NULL REFERENCES laws(code),
  basis       TEXT NOT NULL,         -- 'muse' | 'keyword' | 'manual'
  PRIMARY KEY (incident_id, law_code)
);

-- 受信ログ
CREATE TABLE ingest_logs (
  id           TEXT PRIMARY KEY,
  received_at  TEXT NOT NULL,
  item_count   INTEGER NOT NULL,
  created      INTEGER NOT NULL,
  updated      INTEGER NOT NULL,
  rejected     INTEGER NOT NULL,
  r2_key       TEXT NOT NULL          -- 原本 JSON の保存先
);
```

---

## 5. 受信データ仕様（Muse → 本アプリ）案

```json
{
  "items": [
    {
      "external_id": "muse-20261126-000123",
      "title": "高齢女性から現金300万円をだまし取った疑いで男を逮捕",
      "summary": "警察官を名乗る電話で高齢女性から現金をだまし取ったとして、20代の男が詐欺の疑いで逮捕された。",
      "occurred_on": "2026-11-20",
      "reported_at": "2026-11-26T10:30:00+09:00",
      "prefecture": "大阪府",
      "city": "大阪市",
      "stage": "逮捕",
      "law_codes": ["fraud"],
      "source_url": "https://example.com/news/123",
      "source_name": "○○新聞"
    }
  ]
}
```

| 項目 | 必須 | 説明 |
|---|---|---|
| external_id | ○ | Muse 側の一意な ID（冪等性に使う） |
| title | ○ | 見出し（Muse が書いた文章。記事見出しの転載は避ける） |
| summary | ○ | 要約（Muse が書いた文章。記事本文の転載は不可） |
| occurred_on | − | 発生日 |
| reported_at | ○ | 報道・発表日時 |
| prefecture | ○ | 都道府県 |
| city | − | 市区町村 |
| stage | − | 発生／逮捕／送検／起訴／判決 |
| law_codes | − | 法律マスタのコード（§6） |
| source_url | ○ | 出典 URL（出典のないデータは受け付けない） |
| source_name | − | 媒体名・発表機関名 |

**個人名（被疑者・被害者）を受け付ける項目は設けない。**（§8）

---

## 6. 法律分類マスタ（初期案）

警察統計の区分（刑法犯／特別法犯）を大分類にし、その下に中分類 → 罪名の 3 階層とする。

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

マスタは DB で管理し、管理画面から追加できるようにする。Muse にも同じコード一覧を渡す（`GET /api/v1/laws` で取得できるようにする）。

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

AI が集めたデータを**人の確認なしに自動公開**するため、次を要件として組み込む。

1. **個人名は載せない**: 被疑者・被害者の実名、顔写真、住所などは受け付けず、保存もしない。逮捕されただけの人は有罪が確定していないため、名誉毀損やプライバシー侵害の危険が大きい
2. **推定無罪の表記**: 「逮捕」「送検」段階の事件には「容疑段階であり、有罪が確定したものではありません」と表示する
3. **出典は必須**: 出典 URL のないデータは受け付けない。詳細ページには必ず出典リンクを出す
4. **転載しない**: 記事本文や見出しをそのまま載せず、Muse が書いた要約と出典リンクにとどめる（著作権への配慮）
5. **AI の誤りへの備え**: 「AI が自動で収集・分類した情報で、誤りを含む場合があります」と明記する。管理者がすぐに非公開化できるようにする
6. **削除依頼の窓口**: 問い合わせフォームを設け、受け付けたら一時的に非公開にできる運用を用意する
7. **自動チェック**: 受信時に、人名らしき文字列や電話番号・住所の番地などを機械的に検出し、見つかったら隔離する（簡易的な安全装置）

※ 公開前に、弁護士など専門家の確認を受けることを推奨する。

---

## 9. 未決事項（決めていただきたいこと）

| # | 項目 | 選択肢・論点 |
|---|---|---|
| Q1 | Muse との連携方式 | Muse が本アプリへ **送る（push）** か、本アプリが Muse から **取りに行く（pull）** か。Muse が HTTP リクエストを送れるか |
| Q2 | 送る頻度・量 | 1 日 1 回まとめてか、随時か。1 日あたりの件数の見込み |
| Q3 | 分類の担当 | 法律コードは Muse が付けるか、本アプリが付けるか、両方（Muse 優先＋本アプリが補完）か |
| Q4 | 自動公開の範囲 | 全件を即時公開するか、自動チェックに引っかかったものだけ隔離するか（§8-7） |
| Q5 | 1 事件 1 レコードか | 同じ事件の続報（逮捕 → 起訴 → 判決）を 1 件にまとめるか、別々に載せるか |
| Q6 | 対象とする事件の範囲 | 交通違反のような軽い事件も含めるか。発表元をニュースだけにするか、警察発表も含めるか |
| Q7 | 公開範囲 | 誰でも見られる公開サイトか、限られた人向けか |
| Q8 | 画面の作り | サーバーで HTML を作る（SSR）か、SPA（React など）か。デザインの希望 |
| Q9 | データ保持期間 | 無期限か、一定期間（例: 3 年）で非公開化するか |
| Q10 | ドメイン | 独自ドメインを使うか、`*.workers.dev` か |

---

## 10. 次のステップ

1. 未決事項（§9）を決めて、本書を v0.2 に更新する
2. Muse との受信データ仕様（§5）を確定し、Muse 側と共有する
3. 画面イメージ（ワイヤーフレーム）を作る
4. Cloudflare プロジェクトのひな形（Hono + D1 + R2、wrangler 設定）を作る
5. 受信 API → 公開サイトの順に実装する
