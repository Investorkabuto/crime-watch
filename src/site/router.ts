// 公開サイトのルーティング（SSR HTML, SVG OGP, RSS, sitemap, robots）
import { Hono, type MiddlewareHandler } from "hono";
import type { Env } from "../env";
import { handleCaseFeed, handleMainFeed, handleRobots, handleSitemap, handleThemeFeed } from "../feeds";
import { safeDecodeURIComponent } from "../normalize";
import { THEMES } from "../themes";
import { handleViewerLogin, siteViewerGuard } from "./auth";
import { renderCaseDetailPage, renderCasesListPage } from "./pages/cases";
import { renderHomePage } from "./pages/home";
import { handleContactSubmit, renderAboutMetricsPage, renderAboutPage, renderContactPage } from "./pages/info";
import { renderLawDetailPage, renderLawsListPage } from "./pages/laws";
import { renderPrefectureDetailPage, renderPrefecturesListPage } from "./pages/prefectures";
import { handleStatsCsvExport, renderStatsPage } from "./pages/stats";
import { renderThemeDetailPage, renderThemesListPage } from "./pages/themes";
import { renderOgSvg } from "./svg";

export const siteApp = new Hono<{ Bindings: Env }>();

// robots.txt は認証不要（非公開時は Disallow: / を返す）
siteApp.get("/robots.txt", handleRobots);

// 非公開期間中のブラウザ閲覧ログイン
siteApp.post("/_auth/login", handleViewerLogin);

// 公開時のキャッシュヘッダー制御（非公開時は no-store + noindex）
const cacheHeaders: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  await next();
  if (c.req.method !== "GET") {
    c.header("Cache-Control", "no-store");
    return;
  }
  if (c.env.SITE_PUBLIC !== "true") {
    c.header("Cache-Control", "private, no-store");
    c.header("X-Robots-Tag", "noindex, nofollow");
    return;
  }
  if (!c.res.headers.has("Cache-Control") && c.res.status === 200) {
    c.header("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
  }
};

const skipNonSite = (fn: MiddlewareHandler<{ Bindings: Env }>): MiddlewareHandler<{ Bindings: Env }> => {
  return (c, next) => {
    const p = c.req.path;
    if (p.startsWith("/api/") || p === "/admin" || p === "/robots.txt" || p === "/_auth/login") return next();
    return fn(c, next);
  };
};

siteApp.use("*", skipNonSite(siteViewerGuard));
siteApp.use("*", skipNonSite(cacheHeaders));

// 固定 OGP 画像（SVG）
siteApp.get("/og/default.svg", () => {
  return new Response(renderOgSvg("日本の犯罪報道・判決データ", "法律・テーマ・都道府県別に事実のみを記録"), {
    headers: { "Content-Type": "image/svg+xml; charset=utf-8" },
  });
});

siteApp.get("/og/theme/:theme", (c) => {
  const decoded = safeDecodeURIComponent(c.req.param("theme"));
  const rawName = decoded ? decoded.replace(/\.svg$/, "") : "";
  const title = (THEMES as readonly string[]).includes(rawName) ? rawName : "テーマ別事件データ";
  return new Response(renderOgSvg(title, "テーマ別の報道・判決アーカイブ"), {
    headers: { "Content-Type": "image/svg+xml; charset=utf-8" },
  });
});

// 公開ページ群
siteApp.get("/", renderHomePage);
siteApp.get("/cases", renderCasesListPage);
siteApp.get("/cases/:id/feed.xml", handleCaseFeed);
siteApp.get("/cases/:id", renderCaseDetailPage);
siteApp.get("/themes", renderThemesListPage);
siteApp.get("/themes/:theme/feed.xml", handleThemeFeed);
siteApp.get("/themes/:theme", renderThemeDetailPage);
siteApp.get("/laws", renderLawsListPage);
siteApp.get("/laws/:code", renderLawDetailPage);
siteApp.get("/prefectures", renderPrefecturesListPage);
siteApp.get("/prefectures/:name", renderPrefectureDetailPage);
siteApp.get("/stats", renderStatsPage);
siteApp.get("/stats/export.csv", handleStatsCsvExport);
siteApp.get("/about", renderAboutPage);
siteApp.get("/about/metrics", renderAboutMetricsPage);
siteApp.get("/contact", renderContactPage);
siteApp.post("/contact", handleContactSubmit);

// RSS・サイトマップ
siteApp.get("/feed.xml", handleMainFeed);
siteApp.get("/sitemap.xml", handleSitemap);
