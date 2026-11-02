import type { Request } from 'express';
import type { RequestAuth } from './request-auth';

/** The logged-in user and session; the global auth guard has checked `req.auth`. */
export function authOf(req: Request): RequestAuth {
  if (req.auth === undefined) {
    throw new Error('An authenticated endpoint was reached without req.auth');
  }
  return req.auth;
}
