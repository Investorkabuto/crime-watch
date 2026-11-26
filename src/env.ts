export interface Env {
  DB: D1Database;
  RAW: R2Bucket;
  SITE_PUBLIC: string;
  SIGNATURE_TOLERANCE_SEC: string;
  INGEST_TOKEN?: string;
  INGEST_HMAC_SECRET?: string;
  VIEWER_TOKEN?: string;
}
