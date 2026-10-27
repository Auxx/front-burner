import { CONFIG, Config } from '@front-burner/server-core-config';
import { constantTimeEquals } from '@front-burner/server-core-security';
import { CanActivate, ExecutionContext, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { OnboardingStateService } from './onboarding-state.service';

/**
 * Hides onboarding (AO-3, AO-9, AO-10, AO-33). Guards run before the validation pipe,
 * so a closed onboarding or a wrong token answers exactly like an unknown
 * route, whatever the body holds.
 */
@Injectable()
export class OnboardingGuard implements CanActivate {
  private readonly logger = new Logger(OnboardingGuard.name);

  constructor(
    private readonly state: OnboardingStateService,
    @Inject(CONFIG) private readonly config: Config
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.state.current() === 'completed') {
      throw new NotFoundException();
    }
    const req = context.switchToHttp().getRequest<Request>();
    if (req.method === 'GET') {
      return true;
    }
    // AO-33: with OIDC from the environment, only the first OIDC login completes onboarding.
    if (this.config.oidc !== undefined) {
      throw new NotFoundException();
    }
    const expected = this.config.setupToken;
    if (expected === undefined) {
      throw new NotFoundException();
    }
    const sent: unknown = (req.body as { setupToken?: unknown; } | undefined)?.setupToken;
    if (typeof sent !== 'string' || !constantTimeEquals(sent, expected)) {
      this.logger.warn('Setup token rejected');
      throw new NotFoundException();
    }
    return true;
  }
}
