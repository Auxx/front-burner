// For the `req.auth` declaration.
import '@front-burner/server-core-security';
import type { RequestAuth } from '@front-burner/server-core-security';
import type { Request } from 'express';

/** The logged-in user and session; the global auth guard has checked `req.auth`. */
export function authOf(req: Request): RequestAuth {
  if (req.auth === undefined) {
    throw new Error('A files endpoint reached without req.auth');
  }
  return req.auth;
}
