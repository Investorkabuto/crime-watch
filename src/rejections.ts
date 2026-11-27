// 受け付けなかった項目の一覧。受信した原本（raw_payloads）を検証し直して、理由を出す（DB には書き込まない）
import { itemSchema } from "./schema";

export interface Rejection {
  received_at: string;
  external_id: string | null;
  title: string | null;
  errors: { path: string; message: string }[];
}

/** 直近 days 日の原本から、検証で通らない項目のうち、まだ取り込まれていないもの（送り直しで解決していないもの）を返す */
export async function listRejections(db: D1Database, days: number): Promise<{ rejections: Rejection[]; payloads: number }> {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const { results } = await db
    .prepare("SELECT received_at, body FROM raw_payloads WHERE received_at >= ? ORDER BY received_at DESC")
    .bind(since)
    .all<{ received_at: string; body: string }>();
  const found = new Map<string, Rejection>();
  const noId: Rejection[] = [];
  for (const p of results) {
    let items: unknown[] = [];
    try {
      items = ((JSON.parse(p.body) as { items?: unknown[] }).items ?? []) as unknown[];
    } catch {
      continue;
    }
    for (const raw of items) {
      const parsed = itemSchema.safeParse(raw);
      if (parsed.success) continue;
      const r = raw as Record<string, unknown>;
      const externalId = typeof r?.external_id === "string" ? r.external_id : null;
      const rej: Rejection = {
        received_at: p.received_at,
        external_id: externalId,
        title: typeof r?.title === "string" ? r.title : null,
        errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      };
      if (!externalId) noId.push(rej);
      else if (!found.has(externalId)) found.set(externalId, rej); // 新しい原本から読むので、最初に見つけたものが最新
    }
  }
  // 送り直して取り込まれたものは除く
  const ids = [...found.keys()];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const marks = chunk.map(() => "?").join(",");
    const { results: done } = await db
      .prepare(`SELECT external_id FROM reports WHERE external_id IN (${marks}) UNION SELECT external_id FROM judgments WHERE external_id IN (${marks})`)
      .bind(...chunk, ...chunk)
      .all<{ external_id: string }>();
    for (const d of done) found.delete(d.external_id);
  }
  return { rejections: [...found.values(), ...noId], payloads: results.length };
}
