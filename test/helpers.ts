import { SELF } from "cloudflare:test";
import { hmacSha256Hex } from "../src/auth";

export async function signedIngest(payload: unknown, opts: { token?: string; secret?: string; ts?: number } = {}) {
  const body = JSON.stringify(payload);
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
  const sig = "sha256=" + (await hmacSha256Hex(opts.secret ?? "test-hmac-secret", `${ts}.${body}`));
  return SELF.fetch("https://cw.test/api/v1/ingest", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.token ?? "test-ingest-token"}`,
      "X-CW-Timestamp": ts,
      "X-CW-Signature": sig,
    },
    body,
  });
}

export function view(path: string) {
  return SELF.fetch(`https://cw.test${path}`, { headers: { Authorization: "Bearer test-viewer-token" } });
}

export function adminView(path: string) {
  return SELF.fetch(`https://cw.test${path}`, { headers: { Authorization: "Bearer test-admin-token" } });
}

export function adminPost(path: string, body?: unknown) {
  return SELF.fetch(`https://cw.test${path}`, {
    method: "POST",
    headers: {
      Authorization: "Bearer test-admin-token",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
