import { readFileSync } from 'node:fs';

const config = readFileSync(new URL('../shopify.app.toml', import.meta.url), 'utf8');
const required = [
  'api_version = "2026-07"',
  'scopes = "read_orders"',
  'topics = ["orders/fulfilled"]',
  'topics = ["app/uninstalled"]',
  'compliance_topics = ["customers/data_request", "customers/redact", "shop/redact"]',
  'uri = "/webhooks/orders-fulfilled"',
  'uri = "/webhooks/app-uninstalled"',
  'uri = "/webhooks/compliance"',
];

for (const contract of required) {
  if (!config.includes(contract)) throw new Error(`Missing Shopify app contract: ${contract}`);
}
if (!/^application_url = "https:\/\//m.test(config)) throw new Error('Shopify application_url must use HTTPS.');
if (!/^redirect_urls = \["https:\/\//m.test(config)) throw new Error('Shopify OAuth callback must use HTTPS.');

console.log('Shopify app configuration contract passed.');
