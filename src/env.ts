export interface Env {
  DB: D1Database;
  SITE_PUBLIC: string;
  SIGNATURE_TOLERANCE_SEC: string;
  INGEST_TOKEN?: string;
  INGEST_HMAC_SECRET?: string;
  VIEWER_TOKEN?: string;
  ADMIN_TOKEN?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}
