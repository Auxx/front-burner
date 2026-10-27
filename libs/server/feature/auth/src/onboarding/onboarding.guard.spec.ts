import type { Config } from '@front-burner/server-core-config';
import type { OnboardingState } from '@front-burner/shared-contracts';
import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { OnboardingStateService } from './onboarding-state.service';
import { OnboardingGuard } from './onboarding.guard';

const TOKEN = 'a-setup-token-0123456789';

function contextFor(method: string, body: unknown = { setupToken: TOKEN }): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => ({ method, body }) }) } as unknown as ExecutionContext;
}

function guardFor(state: OnboardingState, oidcFromEnvironment: boolean): OnboardingGuard {
  const config = { setupToken: TOKEN, oidc: oidcFromEnvironment ? {} : undefined } as Config;
  const stateService = { current: () => state } as OnboardingStateService;
  return new OnboardingGuard(stateService, config);
}

describe('OnboardingGuard', () => {
  it('lets a request with a valid setup token through', () => {
    expect(guardFor('required', false).canActivate(contextFor('POST'))).toBe(true);
  });

  it('refuses a wrong setup token', () => {
    expect(() => guardFor('required', false).canActivate(contextFor('POST', { setupToken: 'wrong' }))).toThrow(
      NotFoundException
    );
  });

  it('hides everything once onboarding is completed', () => {
    expect(() => guardFor('completed', false).canActivate(contextFor('GET'))).toThrow(NotFoundException);
  });

  it('hides the data-changing endpoints when OIDC comes from the environment', () => {
    const guard = guardFor('oidc-pending', true);
    for (const method of [ 'POST', 'PUT', 'PATCH', 'DELETE' ]) {
      expect(() => guard.canActivate(contextFor(method))).toThrow(NotFoundException);
    }
    expect(guard.canActivate(contextFor('GET'))).toBe(true);
  });

  it('keeps the data-changing endpoints while oidc-pending from the onboarding page', () => {
    expect(guardFor('oidc-pending', false).canActivate(contextFor('POST'))).toBe(true);
  });
});
