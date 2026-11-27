// 非公開期間中（SITE_PUBLIC !== "true"）のブラウザ閲覧ガード
// Bearer トークン、または簡易ログインで発行する HttpOnly Cookie（HMAC 署名付き）で認証する。
import type { Context, MiddlewareHandler } from "hono";
import { html } from "hono/html";
import { checkBearer, hmacSha256Hex, timingSafeEqualStr } from "../auth";
import type { Env } from "../env";

const COOKIE_NAME = "cw_viewer";
const COOKIE_MESSAGE = "crime-watch-viewer-session-v1";

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

async function expectedCookieToken(viewerToken: string): Promise<string> {
  return hmacSha256Hex(viewerToken, COOKIE_MESSAGE);
}

export async function isViewerAuthorized(c: Context<{ Bindings: Env }>): Promise<boolean> {
  if (c.env.SITE_PUBLIC === "true") return true;
  const expected = c.env.VIEWER_TOKEN;
  if (!expected) return false;
  if (checkBearer(c.req.header("Authorization"), expected)) return true;
  const cookieVal = parseCookie(c.req.header("Cookie"), COOKIE_NAME);
  if (!cookieVal) return false;
  const expectedCookie = await expectedCookieToken(expected);
  return timingSafeEqualStr(cookieVal, expectedCookie);
}

function renderLoginPage(nextPath: string, errorMessage?: string) {
  const safeNext = nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/";
  return html`<!doctype html>
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <title>HANZAI Watch（非公開プレビュー）</title>
        <style>
          :root {
            --bg: #f8f9fb; --surface: #ffffff; --text: #0f172a; --muted: #64748b;
            --line: #e5e7eb; --accent: #3b5bdb; --err: #64748b;
          }
          @media (prefers-color-scheme: dark) {
            :root {
              --bg: #0b0f17; --surface: #131926; --text: #f1f5f9; --muted: #94a3b8;
              --line: #232c3d; --accent: #6c8cff; --err: #cbd5e1;
            }
          }
          * { box-sizing: border-box; }
          body {
            margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px;
            background: var(--bg); color: var(--text);
            font: 15px/1.6 system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif;
          }
          .card {
            width: 100%; max-width: 400px; background: var(--surface); border: 1px solid var(--line);
            border-radius: 16px; padding: 28px 24px; box-shadow: 0 6px 24px rgba(15, 23, 42, 0.05);
          }
          h1 { margin: 0 0 6px; font-size: 20px; letter-spacing: -0.02em; }
          p { margin: 0 0 18px; color: var(--muted); font-size: 13px; }
          label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; }
          input[type="password"] {
            width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px;
            background: var(--bg); color: var(--text); font: inherit; margin-bottom: 14px;
          }
          button {
            width: 100%; padding: 10px 14px; border: 0; border-radius: 10px;
            background: var(--accent); color: #fff; font: inherit; font-weight: 600; cursor: pointer;
          }
          .err {
            margin: 0 0 14px; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line);
            background: var(--bg); color: var(--err); font-size: 13px;
          }
        </style>
      </head>
      <body>
        <main class="card">
          <h1>HANZAI Watch</h1>
          <p>現在は非公開の試行期間中です。閲覧用トークンを入力して続行してください。</p>
          ${errorMessage ? html`<div class="err">${errorMessage}</div>` : ""}
          <form method="post" action="/_auth/login">
            <input type="hidden" name="next" value="${safeNext}" />
            <label for="token">閲覧用トークン</label>
            <input id="token" name="token" type="password" autocomplete="current-password" required autofocus />
            <button type="submit">プレビューを開く</button>
          </form>
        </main>
      </body>
    </html>`;
}

/** 公開サイト向けの閲覧ガードミドルウェア */
export const siteViewerGuard: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  if (await isViewerAuthorized(c)) return next();
  const accept = c.req.header("Accept") ?? "";
  const url = new URL(c.req.url);
  if (accept.includes("text/html") || !c.req.path.endsWith(".xml")) {
    c.header("Cache-Control", "no-store");
    c.header("X-Robots-Tag", "noindex, nofollow");
    return c.html(renderLoginPage(url.pathname + url.search), 401);
  }
  return c.text("Unauthorized", 401);
};

/** 簡易トークン入力の POST ハンドラ */
export async function handleViewerLogin(c: Context<{ Bindings: Env }>) {
  const form = await c.req.parseBody();
  const token = typeof form.token === "string" ? form.token.trim() : "";
  const nextRaw = typeof form.next === "string" ? form.next : "/";
  const nextPath = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/";
  const expected = c.env.VIEWER_TOKEN;

  if (!expected || !token || !timingSafeEqualStr(token, expected)) {
    c.header("Cache-Control", "no-store");
    return c.html(renderLoginPage(nextPath, "トークンが一致しません。"), 401);
  }
  const cookieToken = await expectedCookieToken(expected);
  const isHttps = new URL(c.req.url).protocol === "https:";
  const secureAttr = isHttps ? "; Secure" : "";
  c.header(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(cookieToken)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secureAttr}`,
  );
  c.header("Cache-Control", "no-store");
  return c.redirect(nextPath, 303);
}
