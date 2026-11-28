# Crime Watch

日本国内の犯罪報道と判決（量刑・裁判所・担当裁判官）をデータ化し、法律ごとに分類して公開する Web アプリ。
データは AI「Muse（もち）」が収集して受信 API に送り、本アプリが検証・分類・保存する。

- 要件定義書: [`docs/requirements.md`](docs/requirements.md)
- 受信データの形式: [`schema/ingest.schema.json`](schema/ingest.schema.json)（例: [`schema/examples/`](schema/examples/)）
- 実行環境: Cloudflare Workers（Hono）+ D1（受信した原本も D1 に保存）

現在は**試行（非公開でのデータ蓄積）**の段階（要件 §12）。管理 API には常に `ADMIN_TOKEN` が必要で、非公開期間中の閲覧には `ADMIN_TOKEN`（または任意の `VIEWER_TOKEN`）が必要。

## API

| メソッド | パス | 認証 | 内容 |
|---|---|---|---|
| GET | `/`, `/cases`, `/themes`, `/laws`, `/prefectures`, `/stats`, `/about`, `/contact` | 閲覧（非公開時はログイン画面） | 公開サイト（SSR + SVG + RSS + sitemap） |
| GET | `/admin` | なし（データは管理 API 経由） | 管理画面 |
| GET | `/api/v1/health` | なし | 死活確認。テーブルと初期データがそろっていれば `database: "ready"`（そろっていなければ 503） |
| POST | `/api/v1/ingest` | Bearer `INGEST_TOKEN` + HMAC 署名 | Muse からのデータ受信（1 回 100 件まで） |
| GET | `/api/v1/laws` | 閲覧 | 法律マスタと法定刑 |
| GET | `/api/v1/cases` | 閲覧 | 公開済み事件一覧（`law`, `prefecture`, `from`, `to`, `limit`, `offset`） |
| GET | `/api/v1/cases/:id` | 閲覧 | 公開済み事件詳細（`id` は事件 ID か `case_ref`） |
| GET | `/api/v1/judgments` | 閲覧 | 判決一覧（`law`, `judge`, `court`） |
| GET | `/api/v1/admin/cases` | 管理（`ADMIN_TOKEN`） | 管理用の事件一覧（`status=all\|hidden` で非公開も参照可） |
| GET | `/api/v1/admin/cases/:id` | 管理（`ADMIN_TOKEN`） | 管理用の事件詳細（非公開も参照可） |
| GET | `/api/v1/admin/trial-stats` | 管理（`ADMIN_TOKEN`） | 試行の集計（項目の充足率、未分類率、件数など） |
| POST | `/api/v1/admin/reclassify` | 管理（`ADMIN_TOKEN`） | 罪状辞書の更新後に罪状を判定し直す |
| GET | `/api/v1/admin/prefecture-stats` | 管理（`ADMIN_TOKEN`） | 都道府県別の集計（`basis=occurrence\|police\|court`、`from`、`to`、`law`） |
| GET | `/api/v1/admin/flagged` | 管理（`ADMIN_TOKEN`） | 自動チェックに引っかかった報道・判決 |
| POST | `/api/v1/admin/cases/:id/status` | 管理（`ADMIN_TOKEN`） | 事件の公開・非公開の切り替え（`{"status":"hidden"}`） |
| POST | `/api/v1/admin/aliases` | 管理（`ADMIN_TOKEN`） | 罪状辞書に追加（`{"alias","law_code"}`）し、判定し直す |
| POST | `/api/v1/admin/rescan-flags` | 管理（`ADMIN_TOKEN`） | 自動チェックのルール変更後に、保存済みデータの検出結果を付け直す |
| POST | `/api/v1/admin/recompute-aggregates` | 管理（`ADMIN_TOKEN`） | 公開サイト用の集計テーブルを再計算する（Cron でも毎時実行） |

### 受信 API の署名

```
timestamp = 現在の UNIX 時刻（秒）
signature = hex(HMAC-SHA256(INGEST_HMAC_SECRET, "<timestamp>.<リクエスト本文そのまま>"))

Authorization: Bearer <INGEST_TOKEN>
X-CW-Timestamp: <timestamp>
X-CW-Signature: sha256=<signature>
```

時刻が 5 分以上ずれた署名は拒否する。送信の実装例は [`scripts/sign-request.mjs`](scripts/sign-request.mjs)。

レスポンスは件ごとの結果（`created` / `updated` / `rejected` と理由、未分類の罪状、自動チェックの検出数）を返す。
同じ `external_id` の再送は更新として扱うので、失敗時はそのまま再送してよい。

## 開発

```bash
npm install        # .npmrc で legacy-peer-deps を有効にしている（npm の依存解決の不具合を避けるため）
npm test          # JSON Schema の検証 + Workers 上のテスト
npm run typecheck
```

## Cloudflare への初回セットアップ

```bash
# D1 データベース crime-watch は作成済み（database_id は wrangler.jsonc に記載）
npx wrangler secret put INGEST_TOKEN
npx wrangler secret put INGEST_HMAC_SECRET
npx wrangler secret put ADMIN_TOKEN
# 任意: 非公開期間中に管理者以外へプレビューを共有する場合のみ設定
npx wrangler secret put VIEWER_TOKEN
npm run db:migrate:remote
npm run deploy
```

トークンと鍵はリポジトリや Notion に書かず、Muse には別の方法で渡す。

**注意**: ダッシュボードで登録する場合は、種類を必ず「Secret」（暗号化）にする。「Text」で登録すると、
`wrangler.jsonc` に `vars` があるため、デプロイのたびに消える（`keep_vars: true` で防いでいるが、Secret にするのが正しい）。
