import { DATABASE, Database, users } from '@front-burner/server-core-database';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { IS_ADMIN_ONLY } from '@front-burner/server-core-security';
import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';

/**
 * Refuses routes marked `@AdminOnly()` to users who are not administrators,
 * with `403 forbidden` (A-7.4). Registered after {@link AuthGuard}, so that a
 * request without a valid auth token gets `401` first. The role is read from
 * the user's row on admin routes only: the auth middleware reads no row, and
 * ordinary requests get no query _(plan 132's call)_. Reading it on every
 * admin request also means a role taken away applies at once.
 */
@Injectable()
export class AdminOnlyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DATABASE) private readonly database: Database
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.reflector.getAllAndOverride<boolean>(IS_ADMIN_ONLY, [ context.getHandler(), context.getClass() ])) {
      return true;
    }
    const { auth } = context.switchToHttp().getRequest<Request>();
    if (auth === undefined) {
      throw new ApiErrorException(401, 'unauthenticated');
    }
    const user = this.database.db.select({ role: users.role }).from(users).where(eq(users.id, auth.userId)).get();
    if (user?.role !== 'administrator') {
      throw new ApiErrorException(403, 'forbidden');
    }
    return true;
  }
}
