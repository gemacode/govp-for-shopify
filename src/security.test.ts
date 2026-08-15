import { describe, expect, it } from 'vitest';
import { bytesToBase64, decryptToken, encryptToken, hmacSha256, validShop, verifyOAuthQuery, verifyWebhookHmac } from './security';

describe('Shopify security boundaries', () => {
  it('verifies webhook HMAC and rejects changed content', async () => {
    const body = '{"id":123}'; const secret = 'shopify-secret';
    const signature = bytesToBase64(await hmacSha256(secret, body));
    expect(await verifyWebhookHmac(body, signature, secret)).toBe(true);
    expect(await verifyWebhookHmac('{"id":124}', signature, secret)).toBe(false);
  });

  it('verifies OAuth query canonicalization', async () => {
    const secret = 'shopify-secret'; const message = 'code=abc&shop=demo.myshopify.com&state=xyz&timestamp=1';
    const hmac = Array.from(await hmacSha256(secret, message), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const url = new URL(`https://app.example/auth/callback?shop=demo.myshopify.com&timestamp=1&code=abc&state=xyz&hmac=${hmac}`);
    expect(await verifyOAuthQuery(url, secret)).toBe(true);
  });

  it('validates shop domains and encrypts connector tokens', async () => {
    expect(validShop('demo-shop.myshopify.com')).toBe(true);
    expect(validShop('evil.example.com')).toBe(false);
    const key = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
    const encrypted = await encryptToken('gx_secret', key);
    expect(await decryptToken(encrypted.ciphertext, encrypted.iv, key)).toBe('gx_secret');
  });
});

