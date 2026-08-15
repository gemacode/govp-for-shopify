import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from './index';

describe('Shopify Worker in workerd with D1', () => {
  it('serves its health contract', async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(new Request('https://app.example/health'), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, service: 'GOVP for Shopify', version: '0.1.0' });
  });

  it('applies the native D1 schema', async () => {
    const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all<{ name: string }>();
    expect(tables.results.map((row) => row.name)).toEqual(expect.arrayContaining(['shop_installations', 'webhook_jobs', 'shopify_govps', 'compliance_events']));
  });

  it('rejects a Shopify webhook with an invalid HMAC before persistence', async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(new Request('https://app.example/webhooks/orders-fulfilled', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-shopify-shop-domain': 'native-test.myshopify.com',
        'x-shopify-webhook-id': 'native-test-webhook',
        'x-shopify-hmac-sha256': 'invalid',
      },
      body: JSON.stringify({ id: 42 }),
    }), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(401);
    expect(await env.DB.prepare('SELECT COUNT(*) AS total FROM webhook_jobs').first('total')).toBe(0);
  });
});

