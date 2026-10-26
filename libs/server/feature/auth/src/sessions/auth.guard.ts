import { ApiErrorException } from '@front-burner/server-core-observability';
import { IS_PUBLIC } from '@front-burner/server-core-security';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

/**
 * Refuses every route not marked `@Public()` without a valid auth token of an
 * active session (LG-34). The response says whether the token expired, so
 * that clients know when refreshing can help.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ context.getHandler(), context.getClass() ])) {
      return true;
    }
    const req = context.switchToHttp().getRequest<Request>();
    if (req.auth !== undefined) {
      return true;
    }
    throw req.authFailure === 'expired'
      ? new ApiErrorException(401, 'auth-token-expired')
      : new ApiErrorException(401, 'unauthenticated');
  }
}
