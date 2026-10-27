import { CONFIG, Config } from '@front-burner/server-core-config';
import { ApiExceptionFilter } from '@front-burner/server-core-observability';
import { ArgumentsHost, Catch, ExceptionFilter, Inject, Injectable } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { LoginAuditService } from '../login/login-audit.service';
import { requestInfoOf } from '../login/request-info';
import { OnboardingStateService } from '../onboarding/onboarding-state.service';
import { OIDC_STATE_COOKIE, OIDC_STATE_COOKIE_OPTIONS, oidcFailureLocation } from './oidc-redirects';

/**
 * Records a rate-limited OIDC request in the login audit log (LG-43, LG-65).
 * A rate-limited callback is a browser navigation, so it is sent back to the
 * web client like any failed OIDC login; the exchange answers as usual.
 */
@Injectable()
@Catch(ThrottlerException)
export class OidcRateLimitFilter implements ExceptionFilter {
  private readonly answer = new ApiExceptionFilter();

  constructor(
    private readonly audit: LoginAuditService,
    private readonly onboardingState: OnboardingStateService,
    @Inject(CONFIG) private readonly config: Pick<Config, 'oidc'>
  ) {}

  catch(exception: ThrottlerException, host: ArgumentsHost): void {
    const req = host.switchToHttp().getRequest<Request>();
    this.audit.record({ method: 'oidc', outcome: 'failure', reason: 'rate-limited', ...requestInfoOf(req) });
    if (req.method !== 'GET') {
      this.answer.catch(exception, host);
      return;
    }
    const res = host.switchToHttp().getResponse<Response>();
    res.clearCookie(OIDC_STATE_COOKIE, OIDC_STATE_COOKIE_OPTIONS);
    res.redirect(
      302,
      oidcFailureLocation('rate-limited', this.onboardingState.current(), this.config.oidc !== undefined)
    );
  }
}
