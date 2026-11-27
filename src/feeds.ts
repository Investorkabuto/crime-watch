// RSS 2.0 フィード（全体・テーマ別・事件別）と sitemap.xml / robots.txt
import type { Context } from "hono";
import type { Env } from "./env";
import { PREFECTURES } from "./schema";
import { THEMES } from "./themes";
import { formatSentence } from "./site/format";

function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toRfc822(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date().toUTCString() : d.toUTCString();
}

function buildRss(opts: {
  title: string;
  link: string;
  description: string;
  items: { title: string; link: string; guid: string; pubDate: string; description: string }[];
}): string {
  const body = opts.items
    .map(
      (it) => `    <item>
      <title>${escXml(it.title)}</title>
      <link>${escXml(it.link)}</link>
      <guid isPermaLink="false">${escXml(it.guid)}</guid>
      <pubDate>${escXml(toRfc822(it.pubDate))}</pubDate>
      <description>${escXml(it.description)}</description>
    </item>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escXml(opts.title)}</title>
    <link>${escXml(opts.link)}</link>
    <description>${escXml(opts.description)}</description>
    <language>ja</language>
${body}
  </channel>
</rss>`;
}

/** 全体 RSS /feed.xml（過去分 backfill=1 は除外） */
export async function handleMainFeed(c: Context<{ Bindings: Env }>) {
  const origin = new URL(c.req.url).origin;
  const { results } = await c.env.DB.prepare(
    `SELECT id, title, summary, prefecture, latest_stage, latest_at
     FROM cases
     WHERE status = 'published' AND backfill = 0
     ORDER BY latest_at DESC
     LIMIT 30`,
  ).all<{
    id: string;
    title: string;
    summary: string;
    prefecture: string | null;
    latest_stage: string;
    latest_at: string;
  }>();

  const xml = buildRss({
    title: "Crime Watch — 最新の事件・判決",
    link: origin,
    description: "日本国内の犯罪報道・判決の最新更新（過去データの取り込み分を除く）",
    items: results.map((r) => ({
      title: `[${r.latest_stage}] ${r.title}`,
      link: `${origin}/cases/${encodeURIComponent(r.id)}`,
      guid: `case:${r.id}:${r.latest_at}`,
      pubDate: r.latest_at,
      description: `${r.prefecture ? `【${r.prefecture}】` : ""}${r.summary}`,
    })),
  });
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}

/** テーマ別 RSS /themes/:theme/feed.xml */
export async function handleThemeFeed(c: Context<{ Bindings: Env }>) {
  const theme = decodeURIComponent(c.req.param("theme") ?? "");
  if (!(THEMES as readonly string[]).includes(theme)) return c.text("Not Found", 404);
  const origin = new URL(c.req.url).origin;

  const { results } = await c.env.DB.prepare(
    `SELECT c.id, c.title, c.summary, c.prefecture, c.latest_stage, c.latest_at
     FROM cases c
     JOIN case_themes ct ON ct.case_id = c.id
     WHERE c.status = 'published' AND ct.theme = ?
     ORDER BY c.latest_at DESC
     LIMIT 30`,
  )
    .bind(theme)
    .all<{
      id: string;
      title: string;
      summary: string;
      prefecture: string | null;
      latest_stage: string;
      latest_at: string;
    }>();

  const xml = buildRss({
    title: `Crime Watch — ${theme}`,
    link: `${origin}/themes/${encodeURIComponent(theme)}`,
    description: `テーマ「${theme}」に該当する事件・判決の更新`,
    items: results.map((r) => ({
      title: `[${r.latest_stage}] ${r.title}`,
      link: `${origin}/cases/${encodeURIComponent(r.id)}`,
      guid: `theme:${theme}:${r.id}:${r.latest_at}`,
      pubDate: r.latest_at,
      description: `${r.prefecture ? `【${r.prefecture}】` : ""}${r.summary}`,
    })),
  });
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}

/** 事件ごとの続報 RSS /cases/:id/feed.xml */
export async function handleCaseFeed(c: Context<{ Bindings: Env }>) {
  const id = c.req.param("id");
  const origin = new URL(c.req.url).origin;
  const kase = await c.env.DB.prepare("SELECT id, title, status FROM cases WHERE id = ? OR case_ref = ?")
    .bind(id, id)
    .first<{ id: string; title: string; status: string }>();
  if (!kase) return c.text("Not Found", 404);
  if (kase.status !== "published") return c.text("Gone", 410);

  const [reportsRes, judgRes] = await c.env.DB.batch([
    c.env.DB.prepare(
      "SELECT id, stage, title, summary, reported_at FROM reports WHERE case_id = ? ORDER BY reported_at DESC",
    ).bind(kase.id),
    c.env.DB.prepare(
      `SELECT id, instance, decided_on, sentence_type, term_months, indeterminate_min_months, indeterminate_max_months,
              suspended_months, probation, fine_yen, protective_disposition, summary
       FROM judgments WHERE case_id = ? AND status = 'published' ORDER BY decided_on DESC`,
    ).bind(kase.id),
  ]);

  const caseUrl = `${origin}/cases/${encodeURIComponent(kase.id)}`;
  const items = [
    ...((reportsRes?.results ?? []) as { id: string; stage: string; title: string; summary: string; reported_at: string }[]).map(
      (r) => ({
        title: `[${r.stage}] ${r.title}`,
        link: caseUrl,
        guid: `report:${r.id}`,
        pubDate: r.reported_at,
        description: r.summary,
      }),
    ),
    ...((judgRes?.results ?? []) as {
      id: string;
      instance: string | null;
      decided_on: string;
      sentence_type: string;
      term_months: number | null;
      indeterminate_min_months: number | null;
      indeterminate_max_months: number | null;
      suspended_months: number | null;
      probation: number | null;
      fine_yen: number | null;
      protective_disposition: string | null;
      summary: string;
    }[]).map((j) => ({
      title: `[${j.instance ? `${j.instance}判決` : "判決"}] ${formatSentence(j)}`,
      link: caseUrl,
      guid: `judgment:${j.id}`,
      pubDate: j.decided_on,
      description: j.summary,
    })),
  ].sort((a, b) => b.pubDate.localeCompare(a.pubDate));

  const xml = buildRss({
    title: `${kase.title} — 続報｜Crime Watch`,
    link: caseUrl,
    description: `${kase.title}の報道・判決の時系列更新`,
    items,
  });
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}

/** /sitemap.xml */
export async function handleSitemap(c: Context<{ Bindings: Env }>) {
  const origin = new URL(c.req.url).origin;
  const [lawsRes, casesRes] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT code FROM laws ORDER BY sort_order"),
    c.env.DB.prepare(
      "SELECT id, updated_at FROM cases WHERE status = 'published' ORDER BY latest_at DESC LIMIT 2000",
    ),
  ]);

  const urls: { loc: string; lastmod?: string }[] = [
    { loc: `${origin}/` },
    { loc: `${origin}/cases` },
    { loc: `${origin}/themes` },
    { loc: `${origin}/laws` },
    { loc: `${origin}/prefectures` },
    { loc: `${origin}/stats` },
    { loc: `${origin}/about` },
    { loc: `${origin}/about/metrics` },
    { loc: `${origin}/contact` },
    ...THEMES.map((t) => ({ loc: `${origin}/themes/${encodeURIComponent(t)}` })),
    ...PREFECTURES.map((p) => ({ loc: `${origin}/prefectures/${encodeURIComponent(p)}` })),
    ...((lawsRes?.results ?? []) as { code: string }[]).map((l) => ({
      loc: `${origin}/laws/${encodeURIComponent(l.code)}`,
    })),
    ...((casesRes?.results ?? []) as { id: string; updated_at: string }[]).map((k) => ({
      loc: `${origin}/cases/${encodeURIComponent(k.id)}`,
      lastmod: k.updated_at.slice(0, 10),
    })),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) =>
      `  <url><loc>${escXml(u.loc)}</loc>${u.lastmod ? `<lastmod>${escXml(u.lastmod)}</lastmod>` : ""}</url>`,
  )
  .join("\n")}
</urlset>`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}

/** /robots.txt */
export function handleRobots(c: Context<{ Bindings: Env }>) {
  const origin = new URL(c.req.url).origin;
  if (c.env.SITE_PUBLIC !== "true") {
    return c.text("User-agent: *\nDisallow: /\n", 200, { "Content-Type": "text/plain; charset=utf-8" });
  }
  return c.text(`User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${origin}/sitemap.xml\n`, 200, {
    "Content-Type": "text/plain; charset=utf-8",
  });
}
