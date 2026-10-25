import { randomBytes } from 'node:crypto';

/** Stands in for the nonce in the web client's index.html (A-7.9). */
export const CSP_NONCE_PLACEHOLDER = '__CSP_NONCE__';

/** A fresh nonce for one response: 16 random bytes, base64. */
export function createNonce(): string {
  return randomBytes(16).toString('base64');
}

/** The content security policy of NF-11.1; only `style-src` carries the nonce. */
export function contentSecurityPolicy(nonce: string): string {
  return [
    'default-src \'none\'',
    'script-src \'self\'',
    `style-src 'self' 'nonce-${nonce}'`,
    'img-src \'self\' blob: data: https:',
    'connect-src \'self\'',
    'font-src \'self\'',
    'manifest-src \'self\'',
    'worker-src \'self\'',
    'base-uri \'self\'',
    'form-action \'self\'',
    'frame-ancestors \'none\'',
    'object-src \'none\'',
    'require-trusted-types-for \'script\''
  ].join('; ');
}
