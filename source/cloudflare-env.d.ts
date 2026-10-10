declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    MAKE_API_TOKEN?: string;
    MAKE_ZONE?: string;
    MAKE_DATA_STORE_ID?: string;
    MAKE_SYNC_ENABLED?: string;
    COMPANY_MAILBOX?: string;
    AI_ENABLED?: string;
    MAKE_INBOX_WEBHOOK_SECRET?: string;
    INBOX_OWNER_ID?: string;
    AI_API_KEY?: string;
    AI_MODEL?: string;
  }
}
