import { ApiExceptionFilter } from '@front-burner/server-core-observability';
import { ArgumentsHost, Catch, ExceptionFilter, Injectable } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request } from 'express';
import { LoginAuditService } from './login-audit.service';
import { requestInfoOf } from './request-info';

/** Records a rate-limited login in the login audit log (LG-43), then answers as usual. */
@Injectable()
@Catch(ThrottlerException)
export class RateLimitAuditFilter implements ExceptionFilter {
  private readonly answer = new ApiExceptionFilter();

  constructor(private readonly audit: LoginAuditService) {}

  catch(exception: ThrottlerException, host: ArgumentsHost): void {
    const req = host.switchToHttp().getRequest<Request>();
    const email = (req.body as { email?: unknown; } | undefined)?.email;
    this.audit.record({
      method: 'password',
      outcome: 'failure',
      reason: 'rate-limited',
      email: typeof email === 'string' ? email.trim().slice(0, 254) : null,
      ...requestInfoOf(req)
    });
    this.answer.catch(exception, host);
  }
}
