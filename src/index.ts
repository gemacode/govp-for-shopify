// SPDX-License-Identifier: Apache-2.0
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { bytesToBase64, decryptToken, encryptToken, hmacSha256, validShop, verifyOAuthQuery, verifyWebhookHmac } from './security';

type Bindings = {
  DB: D1Database;
  APP_URL: string;
  EXCHANGE_API_URL: string;
  SHOPIFY_API_KEY: string;
  SHOPIFY_API_SECRET: string;
  TOKEN_ENCRYPTION_KEY: string;
};
type AppContext = Context<{ Bindings: Bindings }>;

type ShopifyOrder = {
  id: number | string;
  name?: string;
  created_at?: string;
  line_items?: Array<{ id?: number | string; product_id?: number | string; variant_id?: number | string; sku?: string; name?: string; quantity?: number }>;
};

type Job = { webhook_id: string; shop: string; external_order_id: string; payload_json: string; attempts: number };
type Installation = { connector_token_ciphertext: string; connector_token_iv: string; shop_name: string; status: string };

const app = new Hono<{ Bindings: Bindings }>();

function html(body: string) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GOVP for Shopify</title><style>body{margin:0;background:#f4f7f5;color:#17231c;font:15px system-ui,sans-serif}.top{background:#fff;border-bottom:1px solid #dce6df;padding:20px max(24px,calc((100vw - 900px)/2));font-weight:800;color:#08794f}.wrap{max-width:900px;margin:0 auto;padding:60px 24px}.card{background:#fff;border:1px solid #dce6df;border-radius:18px;padding:30px;margin-bottom:18px}h1{font-size:42px;letter-spacing:-.04em;margin:0 0 12px}h2{margin-top:0}p{color:#59685f;line-height:1.6}.button{display:inline-block;background:#08794f;color:#fff;text-decoration:none;border:0;border-radius:9px;padding:12px 18px;font-weight:750}.row{display:flex;justify-content:space-between;gap:20px;padding:14px 0;border-top:1px solid #e6ece8}.row a{color:#08794f;font-weight:700}.ok{color:#08794f}.error{color:#a33333}code{font-size:12px}</style></head><body><div class="top">GOVP for Shopify · Gemacode</div><main class="wrap">${body}</main></body></html>`;
}

async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function signedSession(shop: string, secret: string): Promise<string> {
  return `${shop}.${bytesToBase64(await hmacSha256(secret, shop)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}`;
}

async function sessionShop(c: AppContext): Promise<string | null> {
  const value = getCookie(c, 'govp_shopify_session') ?? '';
  const separator = value.lastIndexOf('.'); if (separator < 1) return null;
  const shop = value.slice(0, separator);
  return validShop(shop) && value === await signedSession(shop, c.env.SHOPIFY_API_SECRET) ? shop : null;
}

function randomState() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return bytesToBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

app.get('/', (c) => c.redirect('/app'));
app.get('/health', (c) => c.json({ ok: true, service: 'GOVP for Shopify', version: '0.1.0' }));

app.get('/install', (c) => {
  const shop = (c.req.query('shop') ?? '').toLowerCase();
  if (!validShop(shop)) return c.html(html('<div class="card"><h1>Tienda no válida</h1><p>Inicia la instalación desde Shopify.</p></div>'), 400);
  const state = randomState();
  setCookie(c, 'govp_shopify_oauth_state', state, { httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 600, path: '/auth/callback' });
  const redirect = new URL(`https://${shop}/admin/oauth/authorize`);
  redirect.searchParams.set('client_id', c.env.SHOPIFY_API_KEY);
  redirect.searchParams.set('scope', 'read_orders');
  redirect.searchParams.set('redirect_uri', `${c.env.APP_URL}/auth/callback`);
  redirect.searchParams.set('state', state);
  return c.redirect(redirect.toString());
});

app.get('/auth/callback', async (c) => {
  const url = new URL(c.req.url); const shop = (url.searchParams.get('shop') ?? '').toLowerCase();
  const state = url.searchParams.get('state') ?? ''; const expected = getCookie(c, 'govp_shopify_oauth_state') ?? '';
  if (!validShop(shop) || !state || state !== expected || !await verifyOAuthQuery(url, c.env.SHOPIFY_API_SECRET)) return c.text('Invalid OAuth callback', 401);
  deleteCookie(c, 'govp_shopify_oauth_state', { path: '/auth/callback' });
  const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: c.env.SHOPIFY_API_KEY, client_secret: c.env.SHOPIFY_API_SECRET, code: url.searchParams.get('code') }) });
  if (!tokenResponse.ok) return c.text('Shopify rejected token exchange', 502);
  const connectorResponse = await fetch(`${c.env.EXCHANGE_API_URL}/connectors/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform: 'shopify', label: shop.replace('.myshopify.com', ''), siteUrl: `https://${shop}` }) });
  const connector = await connectorResponse.json() as { apiToken?: string; connector?: { id?: string }; error?: string };
  if (!connectorResponse.ok || !connector.apiToken || !connector.connector?.id) return c.text(connector.error ?? 'GOVP Exchange connection failed', 502);
  const encrypted = await encryptToken(connector.apiToken, c.env.TOKEN_ENCRYPTION_KEY);
  const now = new Date().toISOString();
  await c.env.DB.prepare(`INSERT INTO shop_installations (shop, shop_name, connector_token_ciphertext, connector_token_iv, connector_id, status, installed_at, uninstalled_at) VALUES (?, ?, ?, ?, ?, 'active', ?, NULL) ON CONFLICT(shop) DO UPDATE SET connector_token_ciphertext=excluded.connector_token_ciphertext, connector_token_iv=excluded.connector_token_iv, connector_id=excluded.connector_id, status='active', installed_at=excluded.installed_at, uninstalled_at=NULL`).bind(shop, shop.replace('.myshopify.com', ''), encrypted.ciphertext, encrypted.iv, connector.connector.id, now).run();
  setCookie(c, 'govp_shopify_session', await signedSession(shop, c.env.SHOPIFY_API_SECRET), { httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 30 * 86400, path: '/' });
  return c.redirect('/app');
});

app.get('/app', async (c) => {
  const shop = await sessionShop(c);
  if (!shop) {
    const requested = c.req.query('shop') ?? '';
    if (validShop(requested)) return c.redirect(`/install?shop=${encodeURIComponent(requested)}`);
    return c.html(html('<div class="card"><h1>GOVP for Shopify</h1><p>Instala la aplicación desde Shopify para conectar tu tienda sin escribir código.</p></div>'));
  }
  const installation = await c.env.DB.prepare('SELECT shop_name, status, installed_at FROM shop_installations WHERE shop=?').bind(shop).first<{ shop_name: string; status: string; installed_at: string }>();
  const govps = await c.env.DB.prepare('SELECT external_order_id, order_name, public_code, verify_url, issued_at FROM shopify_govps WHERE shop=? ORDER BY issued_at DESC LIMIT 20').bind(shop).all<Record<string, string>>();
  const failed = await c.env.DB.prepare("SELECT COUNT(*) AS total FROM webhook_jobs WHERE shop=? AND status='failed'").bind(shop).first<{ total: number }>();
  const rows = govps.results.map((item) => `<div class="row"><span><strong>${escapeHtml(item.order_name)}</strong><br><code>${escapeHtml(item.public_code)}</code></span><a href="${escapeHtml(item.verify_url)}" target="_blank" rel="noopener">Comprobar</a></div>`).join('');
  return c.html(html(`<div class="card"><p class="ok">● CONECTADO</p><h1>${escapeHtml(installation?.shop_name ?? shop)}</h1><p>Los pedidos completados generan un GOVP idempotente. Shopify entrega los eventos y Gemacode firma, custodia y publica la comprobación.</p><p class="${failed?.total ? 'error' : 'ok'}">${failed?.total ?? 0} trabajos necesitan atención.</p></div><div class="card"><h2>Últimos GOVP</h2>${rows || '<p>Todavía no se ha emitido ningún GOVP.</p>'}</div><div class="card"><h2>Privacidad</h2><p>La aplicación utiliza referencia de pedido y una huella minimizada de sus líneas. No solicita nombre, correo, dirección ni teléfono del cliente.</p><a href="/privacy">Política del conector</a></div>`));
});

app.get('/privacy', (c) => c.html(html('<div class="card"><h1>Privacidad</h1><p>GOVP for Shopify procesa el dominio de la tienda, identificadores de pedidos y una representación minimizada de líneas de producto para generar GOVP. No conserva nombres, direcciones, correos ni teléfonos. Los webhooks de privacidad permiten acceso y eliminación, y shop/redact elimina la instalación y sus registros.</p><p>Contacto: research@gemacode.org</p></div>')));

function escapeHtml(value: string) { return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char] ?? char)); }

async function verifiedWebhook(c: AppContext): Promise<{ raw: string; shop: string; webhookId: string; topic: string } | Response> {
  const raw = await c.req.text(); const shop = (c.req.header('x-shopify-shop-domain') ?? '').toLowerCase();
  const signature = c.req.header('x-shopify-hmac-sha256') ?? ''; const webhookId = c.req.header('x-shopify-webhook-id') ?? '';
  if (!validShop(shop) || !webhookId || !await verifyWebhookHmac(raw, signature, c.env.SHOPIFY_API_SECRET)) return c.json({ ok: false, error: 'invalid_hmac' }, 401);
  return { raw, shop, webhookId, topic: c.req.header('x-shopify-topic') ?? 'unknown' };
}

app.post('/webhooks/orders-fulfilled', async (c) => {
  const verified = await verifiedWebhook(c); if (verified instanceof Response) return verified;
  const order = JSON.parse(verified.raw) as ShopifyOrder;
  const minimized = { id: String(order.id), name: String(order.name ?? order.id), createdAt: order.created_at ?? null, lineItems: (order.line_items ?? []).map((item) => ({ productId: item.product_id ? String(item.product_id) : null, variantId: item.variant_id ? String(item.variant_id) : null, sku: item.sku ?? '', name: item.name ?? '', quantity: Number(item.quantity ?? 0) })) };
  const now = new Date().toISOString();
  await c.env.DB.prepare(`INSERT OR IGNORE INTO webhook_jobs (webhook_id, shop, topic, external_order_id, payload_json, next_attempt_at, created_at) VALUES (?, ?, 'orders/fulfilled', ?, ?, ?, ?)`).bind(verified.webhookId, verified.shop, minimized.id, JSON.stringify(minimized), now, now).run();
  c.executionCtx.waitUntil(processJob(c.env, verified.webhookId));
  return c.json({ ok: true });
});

app.post('/webhooks/app-uninstalled', async (c) => {
  const verified = await verifiedWebhook(c); if (verified instanceof Response) return verified;
  await c.env.DB.prepare("UPDATE shop_installations SET status='uninstalled', connector_token_ciphertext='', connector_token_iv='', uninstalled_at=? WHERE shop=?").bind(new Date().toISOString(), verified.shop).run();
  return c.json({ ok: true });
});

app.post('/webhooks/compliance', async (c) => {
  const verified = await verifiedWebhook(c); if (verified instanceof Response) return verified;
  const payload = JSON.parse(verified.raw) as { shop_domain?: string; orders_to_redact?: Array<number | string> };
  const now = new Date().toISOString();
  if (verified.topic === 'customers/redact' && payload.orders_to_redact?.length) {
    for (const orderId of payload.orders_to_redact) await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM shopify_govps WHERE shop=? AND external_order_id=?').bind(verified.shop, String(orderId)),
      c.env.DB.prepare('DELETE FROM webhook_jobs WHERE shop=? AND external_order_id=?').bind(verified.shop, String(orderId)),
    ]);
  }
  if (verified.topic === 'shop/redact') await c.env.DB.prepare('DELETE FROM shop_installations WHERE shop=?').bind(verified.shop).run();
  await c.env.DB.prepare('INSERT OR IGNORE INTO compliance_events (webhook_id, shop, topic, processed_at) VALUES (?, ?, ?, ?)').bind(verified.webhookId, verified.shop, verified.topic, now).run();
  return c.json({ ok: true });
});

async function processJob(env: Bindings, webhookId: string): Promise<void> {
  const job = await env.DB.prepare("SELECT webhook_id, shop, external_order_id, payload_json, attempts FROM webhook_jobs WHERE webhook_id=? AND status IN ('pending','failed')").bind(webhookId).first<Job>();
  if (!job) return;
  await env.DB.prepare("UPDATE webhook_jobs SET status='processing' WHERE webhook_id=?").bind(webhookId).run();
  try {
    const installation = await env.DB.prepare("SELECT connector_token_ciphertext, connector_token_iv, shop_name, status FROM shop_installations WHERE shop=?").bind(job.shop).first<Installation>();
    if (!installation || installation.status !== 'active') throw new Error('SHOP_NOT_ACTIVE');
    const order = JSON.parse(job.payload_json) as { id: string; name: string; createdAt: string | null; lineItems: unknown[] };
    const connectorToken = await decryptToken(installation.connector_token_ciphertext, installation.connector_token_iv, env.TOKEN_ENCRYPTION_KEY);
    const evidenceSha = await sha256(JSON.stringify(order));
    const validity = new Date(Date.now() + 365 * 86400_000).toISOString();
    const response = await fetch(`${env.EXCHANGE_API_URL}/connectors/issue`, { method: 'POST', headers: { Authorization: `Bearer ${connectorToken}`, 'Idempotency-Key': `shopify:${(await sha256(job.shop)).slice(0, 16)}:order:${order.id}:fulfilled`, 'Content-Type': 'application/json' }, body: JSON.stringify({ issuer: { name: installation.shop_name }, subject: { type: 'order', id: order.name, name: `Pedido ${order.name}`, description: `${order.lineItems.length} líneas de producto` }, requirement: 'Identifica el pedido y conserva una huella minimizada de las líneas al completarse la entrega.', evidence: [{ label: 'Resumen canónico del pedido', sha256: evidenceSha }], validUntil: validity, source: { platform: 'shopify', externalId: `order-${order.id}` } }) });
    const result = await response.json() as { govp?: { id: string; code: string; verifyUrl: string; issuedAt: string }; error?: string };
    if (!response.ok || !result.govp) throw new Error(result.error ?? `EXCHANGE_${response.status}`);
    await env.DB.batch([
      env.DB.prepare('INSERT OR IGNORE INTO shopify_govps (id, shop, external_order_id, order_name, public_code, verify_url, issued_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(result.govp.id, job.shop, order.id, order.name, result.govp.code, result.govp.verifyUrl, result.govp.issuedAt),
      env.DB.prepare("UPDATE webhook_jobs SET status='completed', completed_at=?, last_error=NULL WHERE webhook_id=?").bind(new Date().toISOString(), webhookId),
    ]);
  } catch (error) {
    const attempts = job.attempts + 1; const next = new Date(Date.now() + Math.min(3600, 60 * (2 ** Math.max(0, attempts - 1))) * 1000).toISOString();
    await env.DB.prepare("UPDATE webhook_jobs SET status=?, attempts=?, next_attempt_at=?, last_error=? WHERE webhook_id=?").bind(attempts >= 8 ? 'failed' : 'pending', attempts, next, error instanceof Error ? error.message.slice(0, 1000) : 'unknown', webhookId).run();
  }
}

async function scheduled(_controller: ScheduledController, env: Bindings, ctx: ExecutionContext) {
  const jobs = await env.DB.prepare("SELECT webhook_id FROM webhook_jobs WHERE status IN ('pending','failed') AND next_attempt_at <= ? AND attempts < 8 ORDER BY next_attempt_at LIMIT 25").bind(new Date().toISOString()).all<{ webhook_id: string }>();
  for (const job of jobs.results) ctx.waitUntil(processJob(env, job.webhook_id));
}

export default { fetch: app.fetch, scheduled };
