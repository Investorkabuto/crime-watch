import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(fileURLToPath(new URL("./migrations", import.meta.url)));
      return {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            INGEST_TOKEN: "test-ingest-token",
            INGEST_HMAC_SECRET: "test-hmac-secret",
            VIEWER_TOKEN: "test-viewer-token",
            ADMIN_TOKEN: "test-admin-token",
          },
        },
      };
    }),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
