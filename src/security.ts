// SPDX-License-Identifier: Apache-2.0
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const result = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) result[index] = binary.charCodeAt(index);
  return result;
}

export async function hmacSha256(secret: string, value: string): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

export function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function verifyWebhookHmac(rawBody: string, provided: string, secret: string): Promise<boolean> {
  try { return constantTimeEqual(await hmacSha256(secret, rawBody), base64ToBytes(provided)); }
  catch { return false; }
}

export async function verifyOAuthQuery(url: URL, secret: string): Promise<boolean> {
  const provided = url.searchParams.get('hmac') ?? '';
  if (!/^[a-f0-9]{64}$/i.test(provided)) return false;
  const message = Array.from(url.searchParams.entries())
    .filter(([key]) => key !== 'hmac' && key !== 'signature')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  const calculated = Array.from(await hmacSha256(secret, message), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return constantTimeEqual(new TextEncoder().encode(calculated), new TextEncoder().encode(provided.toLowerCase()));
}

export function validShop(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(value) && value.length <= 255;
}

export async function encryptToken(value: string, base64Key: string): Promise<{ ciphertext: string; iv: string }> {
  const keyBytes = base64ToBytes(base64Key);
  if (keyBytes.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY_MUST_BE_32_BYTES');
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value));
  return { ciphertext: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

export async function decryptToken(ciphertext: string, iv: string, base64Key: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', base64ToBytes(base64Key), 'AES-GCM', false, ['decrypt']);
  const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(iv) }, key, base64ToBytes(ciphertext));
  return new TextDecoder().decode(clear);
}
