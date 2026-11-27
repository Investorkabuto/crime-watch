import type { D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      SITE_PUBLIC: string;
      SIGNATURE_TOLERANCE_SEC: string;
      INGEST_TOKEN?: string;
      INGEST_HMAC_SECRET?: string;
      VIEWER_TOKEN?: string;
      ADMIN_TOKEN?: string;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
export {};
