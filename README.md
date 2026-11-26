# Crime Watch

日本国内の犯罪報道と判決（量刑・裁判所・担当裁判官）をデータ化し、法律ごとに分類して公開する Web アプリ。
データは AI「Muse（もち）」が収集して受信 API に送り、本アプリが検証・分類・保存する。

- 要件定義書: [`docs/requirements.md`](docs/requirements.md)
- 受信データの形式: [`schema/ingest.schema.json`](schema/ingest.schema.json)（例: [`schema/examples/`](schema/examples/)）
- 実行環境: Cloudflare Workers（Hono）+ D1 + R2

現在は**試行（非公開でのデータ蓄積）**の段階（要件 §12）。閲覧 API には `VIEWER_TOKEN` が必要。

## API

| メソッド | パス | 認証 | 内容 |
|---|---|---|---|
| GET | `/api/v1/health` | なし | 死活確認 |
| POST | `/api/v1/ingest` | Bearer `INGEST_TOKEN` + HMAC 署名 | Muse からのデータ受信（1 回 100 件まで） |
| GET | `/api/v1/laws` | 閲覧 | 法律マスタと法定刑 |
| GET | `/api/v1/cases` | 閲覧 | 事件一覧（`law`, `prefecture`, `from`, `to`, `limit`, `offset`） |
| GET | `/api/v1/cases/:id` | 閲覧 | 事件詳細（`id` は事件 ID か `case_ref`） |
| GET | `/api/v1/judgments` | 閲覧 | 判決一覧（`law`, `judge`, `court`） |
| GET | `/api/v1/admin/trial-stats` | 閲覧 | 試行の集計（項目の充足率、未分類率、件数など） |
| POST | `/api/v1/admin/reclassify` | 閲覧 | 罪状辞書の更新後に罪状を判定し直す |

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
npm install --legacy-peer-deps
npm test          # JSON Schema の検証 + Workers 上のテスト
npm run typecheck
```

## Cloudflare への初回セットアップ

```bash
npx wrangler d1 create crime-watch          # 表示された database_id を wrangler.jsonc に書く
npx wrangler r2 bucket create crime-watch-raw
npx wrangler secret put INGEST_TOKEN
npx wrangler secret put INGEST_HMAC_SECRET
npx wrangler secret put VIEWER_TOKEN
npm run db:migrate:remote
npm run deploy
```

トークンと鍵はリポジトリや Notion に書かず、Muse には別の方法で渡す。
