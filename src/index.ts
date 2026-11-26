import { Hono, type MiddlewareHandler } from "hono";
import { checkBearer, verifySignature } from "./auth";
import type { Env } from "./env";
import { ingestItem, loadDictionary, type ItemResult } from "./ingest";
import { classifyCharges } from "./classify";
import { MAX_ITEMS } from "./schema";
import { nowIso } from "./normalize";
import { trialStats } from "./stats";

// D1 の 1 行あたりの上限（約 2MB）に収まるよう、原本の保存を考えて 1MB までにする
const MAX_BODY_BYTES = 1024 * 1024;

const app = new Hono<{ Bindings: Env }>();

app.get("/api/v1/health", (c) => c.json({ ok: true }));

// ===== 受信 API（Muse → Crime Watch）=====
app.post("/api/v1/ingest", async (c) => {
  if (!checkBearer(c.req.header("Authorization"), c.env.INGEST_TOKEN)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const body = await c.req.text();
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) return c.json({ error: "payload_too_large" }, 413);
  const sig = await verifySignature({
    secret: c.env.INGEST_HMAC_SECRET,
    timestamp: c.req.header("X-CW-Timestamp"),
    signature: c.req.header("X-CW-Signature"),
    body,
    toleranceSec: Number(c.env.SIGNATURE_TOLERANCE_SEC || "300"),
  });
  if (!sig.ok) return c.json({ error: "invalid_signature", reason: sig.reason }, 401);

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const items = (payload as { items?: unknown })?.items;
  if (!Array.isArray(items) || items.length === 0) return c.json({ error: "items_required" }, 400);
  if (items.length > MAX_ITEMS) return c.json({ error: "too_many_items", max: MAX_ITEMS }, 400);

  const logId = crypto.randomUUID();
  const receivedAt = nowIso();

  const dict = await loadDictionary(c.env.DB);
  const results: ItemResult[] = [];
  for (let i = 0; i < items.length; i++) {
    try {
      results.push(await ingestItem(c.env.DB, dict, items[i], i));
    } catch (e) {
      console.error("ingest item failed", i, e);
      results.push({
        index: i,
        external_id: (items[i] as { external_id?: string })?.external_id ?? null,
        status: "rejected",
        errors: [{ path: "", message: "internal_error" }],
      });
    }
  }
  const count = (s: ItemResult["status"]) => results.filter((r) => r.status === s).length;
  const summary = {
    created: count("created"),
    updated: count("updated"),
    rejected: count("rejected"),
    flagged: results.filter((r) => r.flags).length,
  };
  // 受信ログと原本（監査・再処理用）を保存する
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO ingest_logs (id, received_at, item_count, created, updated, rejected, flagged) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(logId, receivedAt, items.length, summary.created, summary.updated, summary.rejected, summary.flagged),
    c.env.DB.prepare("INSERT INTO raw_payloads (ingest_id, received_at, body) VALUES (?, ?, ?)").bind(logId, receivedAt, body),
  ]);
  return c.json({ ingest_id: logId, ...summary, results });
});

// ===== 閲覧 API（非公開期間中は VIEWER_TOKEN が必要）=====
const viewerGuard: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  if (c.env.SITE_PUBLIC === "true") return next();
  if (!checkBearer(c.req.header("Authorization"), c.env.VIEWER_TOKEN)) return c.json({ error: "unauthorized" }, 401);
  return next();
};
app.use("/api/v1/laws", viewerGuard);
app.use("/api/v1/cases", viewerGuard);
app.use("/api/v1/cases/*", viewerGuard);
app.use("/api/v1/judgments", viewerGuard);
app.use("/api/v1/admin/*", viewerGuard);

app.get("/api/v1/laws", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT l.*, (SELECT json_group_array(json_object('effective_from', p.effective_from, 'effective_to', p.effective_to,
        'statutory_penalty', p.statutory_penalty, 'verified', p.verified)) FROM law_penalty_periods p WHERE p.law_code = l.code) AS penalties
     FROM laws l ORDER BY l.sort_order`,
  ).all();
  return c.json({ laws: results.map((r) => ({ ...r, penalties: JSON.parse((r as { penalties: string }).penalties) })) });
});

app.get("/api/v1/cases", async (c) => {
  const q = c.req.query();
  const where: string[] = ["c.status = 'published'"];
  const binds: unknown[] = [];
  if (q.law) {
    where.push(
      `(EXISTS (SELECT 1 FROM reports r JOIN report_charges rc ON rc.report_id = r.id WHERE r.case_id = c.id AND rc.law_code = ?)
        OR EXISTS (SELECT 1 FROM judgments j JOIN judgment_charges jc ON jc.judgment_id = j.id WHERE j.case_id = c.id AND jc.law_code = ?))`,
    );
    binds.push(q.law, q.law);
  }
  if (q.prefecture) {
    where.push("c.prefecture = ?");
    binds.push(q.prefecture);
  }
  if (q.from) {
    where.push("c.latest_at >= ?");
    binds.push(q.from);
  }
  if (q.to) {
    where.push("c.latest_at < ?");
    binds.push(q.to);
  }
  if (q.include_backfill !== "true" && q.new_only === "true") where.push("c.backfill = 0");
  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
  const offset = Math.max(Number(q.offset) || 0, 0);
  const { results } = await c.env.DB.prepare(
    `SELECT c.id, c.case_ref, c.title, c.summary, c.occurred_on, c.prefecture,
            CASE WHEN c.is_juvenile = 1 THEN NULL ELSE c.city END AS city,
            c.is_juvenile, c.latest_stage, c.latest_at, c.backfill, c.flagged
     FROM cases c WHERE ${where.join(" AND ")} ORDER BY c.latest_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...binds, limit, offset)
    .all();
  return c.json({ cases: results, limit, offset });
});

app.get("/api/v1/cases/:id", async (c) => {
  const id = c.req.param("id");
  const db = c.env.DB;
  const kase = await db
    .prepare(
      `SELECT id, case_ref, title, summary, occurred_on, prefecture, CASE WHEN is_juvenile = 1 THEN NULL ELSE city END AS city,
              is_juvenile, latest_stage, latest_at, backfill, flagged, status FROM cases WHERE id = ? OR case_ref = ?`,
    )
    .bind(id, id)
    .first<{ id: string; is_juvenile: number }>();
  if (!kase) return c.json({ error: "not_found" }, 404);
  const [reports, rcharges, persons, judgments, jcharges, judges] = await db.batch([
    db.prepare(
      `SELECT id, external_id, stage, title, summary, reported_at, occurred_on, prefecture,
              CASE WHEN ?2 = 1 THEN NULL ELSE city END AS city, link_confidence, backfill, source_url, source_name,
              additional_sources, flags FROM reports WHERE case_id = ?1 ORDER BY reported_at`,
    ).bind(kase.id, kase.is_juvenile),
    db.prepare(
      `SELECT rc.report_id, rc.charge_text, rc.raw_text, rc.law_code, l.name AS law_name, rc.modifier FROM report_charges rc
       JOIN reports r ON r.id = rc.report_id LEFT JOIN laws l ON l.code = rc.law_code WHERE r.case_id = ? ORDER BY rc.seq`,
    ).bind(kase.id),
    db.prepare(
      `SELECT p.report_id, p.gender, CASE WHEN ?2 = 1 THEN NULL ELSE p.age END AS age, p.age_group, p.juvenile_class
       FROM report_persons p JOIN reports r ON r.id = p.report_id WHERE r.case_id = ?1 ORDER BY p.seq`,
    ).bind(kase.id, kase.is_juvenile),
    db.prepare(
      `SELECT j.*, co.name AS court_name, co.level AS court_level FROM judgments j JOIN courts co ON co.id = j.court_id
       WHERE j.case_id = ? ORDER BY j.decided_on`,
    ).bind(kase.id),
    db.prepare(
      `SELECT jc.judgment_id, jc.charge_text, jc.raw_text, jc.law_code, l.name AS law_name, jc.modifier, jc.is_primary
       FROM judgment_charges jc JOIN judgments j ON j.id = jc.judgment_id LEFT JOIN laws l ON l.code = jc.law_code
       WHERE j.case_id = ? ORDER BY jc.seq`,
    ).bind(kase.id),
    db.prepare(
      `SELECT jj.judgment_id, jj.role, g.id AS judge_id, g.name FROM judgment_judges jj JOIN judges g ON g.id = jj.judge_id
       JOIN judgments j ON j.id = jj.judgment_id WHERE j.case_id = ?`,
    ).bind(kase.id),
  ]);
  const by = <T extends Record<string, unknown>>(rows: T[], key: string, id: unknown) => rows.filter((r) => r[key] === id);
  const rc = (rcharges?.results ?? []) as Record<string, unknown>[];
  const ps = (persons?.results ?? []) as Record<string, unknown>[];
  const jc = (jcharges?.results ?? []) as Record<string, unknown>[];
  const jg = (judges?.results ?? []) as Record<string, unknown>[];
  return c.json({
    case: kase,
    reports: ((reports?.results ?? []) as Record<string, unknown>[]).map((r) => ({
      ...r,
      charges: by(rc, "report_id", r.id),
      suspects: by(ps, "report_id", r.id),
    })),
    judgments: ((judgments?.results ?? []) as Record<string, unknown>[]).map((j) => {
      const { person_ref: _omit, ...rest } = j; // 人物 ID は内部用なので出さない
      if (kase.is_juvenile) rest.defendant_age = null;
      return { ...rest, charges: by(jc, "judgment_id", j.id), judges: by(jg, "judgment_id", j.id) };
    }),
  });
});

app.get("/api/v1/judgments", async (c) => {
  const q = c.req.query();
  const where: string[] = ["j.status = 'published'"];
  const binds: unknown[] = [];
  if (q.law) {
    where.push("j.primary_law_code = ?");
    binds.push(q.law);
  }
  if (q.judge) {
    where.push("EXISTS (SELECT 1 FROM judgment_judges jj WHERE jj.judgment_id = j.id AND jj.judge_id = ?)");
    binds.push(q.judge);
  }
  if (q.court) {
    where.push("j.court_id = ?");
    binds.push(q.court);
  }
  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
  const offset = Math.max(Number(q.offset) || 0, 0);
  const { results } = await c.env.DB.prepare(
    `SELECT j.id, j.case_id, j.decided_on, co.name AS court_name, j.instance, j.sentence_type, j.term_months,
            j.suspended_months, j.fine_yen, j.demand_type, j.demand_months, j.primary_law_code, j.position_in_range,
            j.ratio_to_demand, j.defendant_gender, j.defendant_age_group, j.juvenile_class, j.title
     FROM judgments j JOIN courts co ON co.id = j.court_id WHERE ${where.join(" AND ")}
     ORDER BY j.decided_on DESC LIMIT ? OFFSET ?`,
  )
    .bind(...binds, limit, offset)
    .all();
  return c.json({ judgments: results, limit, offset });
});

// ===== 管理・試行用 =====
app.get("/api/v1/admin/trial-stats", async (c) => c.json(await trialStats(c.env.DB)));

/** 罪状辞書を更新した後に、保存済みの罪状を判定し直す */
app.post("/api/v1/admin/reclassify", async (c) => {
  const db = c.env.DB;
  const dict = await loadDictionary(db);
  let changed = 0;
  for (const table of ["report_charges", "judgment_charges"] as const) {
    const parent = table === "report_charges" ? "report_id" : "judgment_id";
    const { results } = await db.prepare(`SELECT ${parent} AS pid, seq, charge_text FROM ${table}`).all<{
      pid: string;
      seq: number;
      charge_text: string;
    }>();
    const stmts: D1PreparedStatement[] = [];
    for (const r of results) {
      const [hit] = classifyCharges([r.charge_text], dict.aliases);
      stmts.push(
        db
          .prepare(`UPDATE ${table} SET law_code = ?, matched_alias = ? WHERE ${parent} = ? AND seq = ? AND law_code IS NOT ?`)
          .bind(hit?.lawCode ?? null, hit?.matchedAlias ?? null, r.pid, r.seq, hit?.lawCode ?? null),
      );
    }
    for (let i = 0; i < stmts.length; i += 100) {
      const res = await db.batch(stmts.slice(i, i + 100));
      changed += res.reduce((n, x) => n + (x.meta.changes ?? 0), 0);
    }
  }
  // 注意: 量刑指標の基準（最も重い罪）と指標の値は、判決を再送してもらうと計算し直される
  return c.json({ changed });
});

app.notFound((c) => c.json({ error: "not_found" }, 404));

export default app;
