import type { Request } from 'express';
import type { RequestInfo } from './login-audit.service';

/** The client address (honouring `trust proxy`) and user agent of a request. */
export function requestInfoOf(req: Request): RequestInfo {
  return { ip: req.ip ?? '', userAgent: req.get('user-agent') };
}
