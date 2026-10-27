// For the `req.auth` declaration.
import '@front-burner/server-core-security';
import type { RequestAuth } from '@front-burner/server-core-security';
import { NotFoundException } from '@nestjs/common';
import type { Request } from 'express';

/** The logged-in user and session; the global auth guard has checked `req.auth`. */
export function authOf(req: Request): RequestAuth {
  if (req.auth === undefined) {
    throw new Error('A credentials route was reached without req.auth');
  }
  return req.auth;
}

/** A positive integer route ID; anything else is the `404` of an unknown ID (AR-56). */
export function parseId(text: string): number {
  if (!/^[1-9]\d{0,14}$/.test(text)) {
    throw new NotFoundException();
  }
  return Number(text);
}
