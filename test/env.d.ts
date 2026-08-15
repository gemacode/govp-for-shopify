declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    APP_URL: string;
    EXCHANGE_API_URL: string;
    SHOPIFY_API_KEY: string;
    SHOPIFY_API_SECRET: string;
    TOKEN_ENCRYPTION_KEY: string;
    TEST_MIGRATIONS: D1Migration[];
  }
}
