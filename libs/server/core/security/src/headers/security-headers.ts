import type { RequestHandler } from 'express';

/** Only features Chromium recognises: it warns in the console about any other. */
const DENIED_FEATURES = [
  'accelerometer',
  'autoplay',
  'camera',
  'display-capture',
  'encrypted-media',
  'fullscreen',
  'gamepad',
  'geolocation',
  'gyroscope',
  'hid',
  'identity-credentials-get',
  'idle-detection',
  'local-fonts',
  'magnetometer',
  'microphone',
  'midi',
  'payment',
  'picture-in-picture',
  'publickey-credentials-create',
  'publickey-credentials-get',
  'screen-wake-lock',
  'serial',
  'storage-access',
  'sync-xhr',
  'usb',
  'xr-spatial-tracking'
];

/**
 * Every policy-controlled feature is denied, except that the page itself may
 * write to the clipboard (copy buttons, copying a generated SSH public key).
 */
export const PERMISSIONS_POLICY = [
  ...DENIED_FEATURES.map(feature => `${feature}=()`),
  'clipboard-write=(self)'
].join(', ');

/** Sets the security headers of NF-11.2 on every response. */
export function securityHeaders(): RequestHandler {
  return (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (req.secure) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    }
    next();
  };
}
