#!/usr/bin/env node
// 受信 API への送信サンプル（Muse 側の実装の参考、および動作確認用）
//
// 使い方:
//   INGEST_URL=https://<worker>/api/v1/ingest INGEST_TOKEN=... INGEST_HMAC_SECRET=... \
//     node scripts/sign-request.mjs schema/examples/report.json
//   --dry-run を付けると送信せず、付けるヘッダーだけを表示する（トークンと鍵は伏せる）
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: node scripts/sign-request.mjs <payload.json> [--dry-run]");
  process.exit(2);
}
const { INGEST_URL, INGEST_TOKEN, INGEST_HMAC_SECRET } = process.env;
if (!INGEST_TOKEN || !INGEST_HMAC_SECRET || (!INGEST_URL && !dryRun)) {
  console.error("INGEST_URL, INGEST_TOKEN, INGEST_HMAC_SECRET を環境変数で指定してください");
  process.exit(2);
}

// 本文は「送るバイト列そのもの」に署名する。整形し直すと署名が合わなくなる
const body = readFileSync(file, "utf8");
const timestamp = String(Math.floor(Date.now() / 1000));
const signature = "sha256=" + createHmac("sha256", INGEST_HMAC_SECRET).update(`${timestamp}.${body}`).digest("hex");
const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${INGEST_TOKEN}`,
  "X-CW-Timestamp": timestamp,
  "X-CW-Signature": signature,
};

if (dryRun) {
  console.log({ ...headers, Authorization: "Bearer ***" });
  process.exit(0);
}
const res = await fetch(INGEST_URL, { method: "POST", headers, body });
console.log(res.status, await res.text());
process.exit(res.ok ? 0 : 1);
