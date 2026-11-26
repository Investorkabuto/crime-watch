// 管理画面（src/admin-page.ts）の埋め込みスクリプトが JavaScript として正しいかを確かめる
// （テンプレート文字列の中のエスケープ漏れで、画面が真っ白になるのを防ぐため）
import { build } from "esbuild";

const out = await build({ entryPoints: ["src/admin-page.ts"], bundle: true, format: "esm", write: false, platform: "neutral" });
const mod = await import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));
const m = mod.ADMIN_PAGE.match(/<script>([\s\S]*)<\/script>/);
if (!m) {
  console.error("NG admin-page: <script> が見つかりません");
  process.exit(1);
}
try {
  new Function(m[1]);
  console.log("ok admin-page script");
} catch (e) {
  console.error("NG admin-page script:", e.message);
  process.exit(1);
}
