// 受信 API の認証（Bearer トークン + HMAC-SHA256 署名）
//
// 署名の作り方（Muse 側）:
//   timestamp = 現在の UNIX 時刻（秒）
//   signature = hex( HMAC-SHA256( INGEST_HMAC_SECRET, `${timestamp}.${リクエスト本文そのまま}` ) )
//   ヘッダー:
//     Authorization: Bearer <INGEST_TOKEN>
//     X-CW-Timestamp: <timestamp>
//     X-CW-Signature: sha256=<signature>

const encoder = new TextEncoder();

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  // 長さが違っても同じ時間をかけて比較する
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function checkBearer(header: string | undefined | null, expected: string | undefined): boolean {
  if (!expected || !header) return false;
  const m = header.match(/^Bearer\s+(.+)$/);
  return !!m && timingSafeEqualStr(m[1] ?? "", expected);
}

export type SignatureResult = { ok: true } | { ok: false; reason: string };

export async function verifySignature(opts: {
  secret: string | undefined;
  timestamp: string | undefined | null;
  signature: string | undefined | null;
  body: string;
  toleranceSec: number;
  nowSec?: number;
}): Promise<SignatureResult> {
  if (!opts.secret) return { ok: false, reason: "server_not_configured" };
  if (!opts.timestamp || !/^\d+$/.test(opts.timestamp)) return { ok: false, reason: "missing_timestamp" };
  if (!opts.signature) return { ok: false, reason: "missing_signature" };
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(opts.timestamp)) > opts.toleranceSec) return { ok: false, reason: "timestamp_out_of_range" };
  const expected = "sha256=" + (await hmacSha256Hex(opts.secret, `${opts.timestamp}.${opts.body}`));
  if (!timingSafeEqualStr(opts.signature, expected)) return { ok: false, reason: "bad_signature" };
  return { ok: true };
}
